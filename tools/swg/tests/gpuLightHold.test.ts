// The GPU port's pass 1, wave 2, in node: three's indirect light on WebGPU held at 0.187's over three's development commit
// 577fb27 (`src/core/gpu/gpuLightHold.ts`), held to its structure, since node draws nothing (a browser's picture pairs hold the
// pixels).
//
//  1. the held model is three's physical model and the client's highlight's and the ground's build on it;
//  2. it reflects no ambient or hemisphere light, where three's own model now does (`indirectRadiance`);
//  3. its plain indirect light is 0.187's three steps: the ambient's diffuse cut by the dielectric share, the environment's
//     reflection and its fill beside it, and the occlusion after both; a sheen, a clear coat or a rough diffuse keeps three's;
//  4. the part goes on every lit standard copy and hands three's plain model over as the held one, leaving any other;
//  5. an environment's fill goes to the context's own record of it while the environment is set up, never to the ambient's.
//
// Run: node tools/swg/tests/gpuLightHold.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshStandardNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import { float, vec2, vec3 } from 'three/tsl';
import { HeldLightingModel, LIGHT_HOLD_STATS, keepFillApart, lightHoldPart } from '../../../src/core/gpu/gpuLightHold.ts';
import { ClientLightingModel } from '../../../src/core/gpu/gpuSpec.ts';
import { GroundLightingModel } from '../../../src/core/gpu/gpuGround.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

/** A node standing in for a context value, counting what is assigned to it (outside a build, three keeps no assignment). */
const counted = (): Any => {
  const n: Any = vec3(0).toVar();
  n.adds = 0;
  n.muls = 0;
  n.addAssign = () => (n.adds++, n);
  n.mulAssign = () => (n.muls++, n);
  return n;
};
const builderWith = (extra: Record<string, unknown> = {}): Any => ({
  context: {
    radiance: counted(),
    irradiance: counted(),
    ambientOcclusion: float(1).toVar(),
    reflectedLight: { directDiffuse: counted(), directSpecular: counted(), indirectDiffuse: counted(), indirectSpecular: counted() },
    ...extra,
  },
});
const plainModel = (m: Any): Any => {
  m.singleScatteringDielectric = vec3(0.04).toVar();
  m.multiScatteringDielectric = vec3(0.01).toVar();
  m.dfg = vec2(0.9, 0.05);
  // Three's own split-sum for the metallic half assigns into its two variables, which needs a build: counted instead.
  m.metallicAsked = 0;
  m.computeMultiscattering = () => void m.metallicAsked++;
  return m;
};

// ---------------------------------------------------------------- 1. the models
{
  ok(new HeldLightingModel() instanceof (PhysicalLightingModel as Any), "the held model is three's physical model");
  ok(ClientLightingModel.prototype instanceof (HeldLightingModel as Any) && GroundLightingModel.prototype instanceof (HeldLightingModel as Any), "the client's highlight's model and the ground's build on it");
  const from: Any = new (PhysicalLightingModel as Any)(true, false, false, false, false, false);
  const held: Any = new HeldLightingModel(from);
  ok(held.clearcoat === true && held.sheen === false && held.heldIndirect === false, "made from three's model, it keeps its features, and a clear coat keeps three's own indirect light");
  ok((new HeldLightingModel() as Any).heldIndirect === true, 'a plain standard model is held');
}

// ---------------------------------------------------------------- 2. no reflection of the ambient lights
{
  const three: Any = new (PhysicalLightingModel as Any)();
  const b3 = builderWith();
  three.indirectRadiance(() => vec3(1), b3);
  ok(b3.context.radiance.adds === 1, "three's own model at its development commit reflects an ambient or a hemisphere light (the change held)");
  const held: Any = new HeldLightingModel();
  const b = builderWith();
  held.indirectRadiance(() => vec3(1), b);
  ok(b.context.radiance.adds === 0, 'the held model reflects none (0.187 reflected an environment map alone)');
  const pkg = readFileSync(new URL('../../../node_modules/three/src/nodes/lighting/HemisphereLightNode.js', import.meta.url), 'utf8');
  const amb = readFileSync(new URL('../../../node_modules/three/src/nodes/lighting/AmbientLightNode.js', import.meta.url), 'utf8');
  ok(/builder\.context\.lightingModel\.indirectRadiance\( irradianceAt, builder \);/.test(pkg) && /builder\.context\.lightingModel\.indirectRadiance\( \(\) => colorNode, builder \);/.test(amb), "both lights ask the material's model to reflect them, which is where the hold says no");
}

// ---------------------------------------------------------------- 3. 0.187's three steps
{
  const held: Any = plainModel(new HeldLightingModel());
  const b = builderWith();
  held.indirectDiffuse(b);
  const rl = b.context.reflectedLight;
  ok(rl.indirectDiffuse.adds === 1 && rl.indirectSpecular.adds === 0, "the indirect diffuse adds the ambient's diffuse once, cut by the dielectric share");
  held.indirectSpecular(b);
  ok(rl.indirectSpecular.adds === 1 && rl.indirectDiffuse.adds === 2 && held.metallicAsked === 1, "the indirect specular adds the environment's reflection (its metallic half worked out by three's own split sum) and, beside it, the environment's fill");
  held.ambientOcclusion(b);
  ok(rl.indirectDiffuse.muls === 1 && rl.indirectSpecular.muls === 1, 'and the occlusion darkens both after (0.187: no multiple bounce, never inside the diffuse)');
  // With a fill kept apart, the specular reads it rather than nought.
  const b2 = builderWith({ swgIblIrradiance: vec3(0.5).toVar() });
  held.indirectSpecular(b2);
  ok(b2.context.reflectedLight.indirectSpecular.adds === 1 && b2.context.reflectedLight.indirectDiffuse.adds === 1, "and with an environment's fill on the context the same two are added from it");
  // A sheen keeps three's own: called through, three's diffuse reads the occlusion's multiple bounce (the commit's).
  let called = 0;
  const own = (PhysicalLightingModel.prototype as Any).indirectDiffuse;
  (PhysicalLightingModel.prototype as Any).indirectDiffuse = function () {
    called++;
  };
  try {
    const sheen: Any = new HeldLightingModel(new (PhysicalLightingModel as Any)(false, true));
    sheen.indirectDiffuse(builderWith());
    plainModel(new HeldLightingModel()).indirectDiffuse(builderWith());
  } finally {
    (PhysicalLightingModel.prototype as Any).indirectDiffuse = own;
  }
  ok(called === 1, "a sheen's model keeps three's own indirect diffuse, a plain one never calls it");
}

// ---------------------------------------------------------------- 4. the part
{
  ok(lightHoldPart.applies(new THREE.MeshStandardMaterial()) && lightHoldPart.applies(new THREE.MeshPhysicalMaterial()) && !lightHoldPart.applies(new THREE.MeshBasicMaterial()) && !lightHoldPart.applies(new THREE.MeshLambertMaterial()), 'the part goes on every lit standard copy and nowhere else');
  const node: Any = new MeshStandardNodeMaterial();
  const before = LIGHT_HOLD_STATS.models;
  lightHoldPart.apply(node, new THREE.MeshStandardMaterial());
  const m = node.setupLightingModel({});
  ok(m instanceof (HeldLightingModel as Any) && LIGHT_HOLD_STATS.models === before + 1, "three's plain physical model comes back held");
  const other: Any = new MeshStandardNodeMaterial();
  const mine = new (class extends (PhysicalLightingModel as Any) {})();
  other.setupLightingModel = () => mine;
  lightHoldPart.apply(other, new THREE.MeshStandardMaterial());
  ok(other.setupLightingModel({}) === mine, 'any other model is handed back as it is');
  const start = readFileSync(new URL('../../../src/core/gpu/start.ts', import.meta.url), 'utf8');
  ok(/LOOK_PARTS\.push\(lightHoldPart, detailPart, specPart, cardPart, eyeGlowPart\);/.test(start), 'start.ts puts it on first, so the highlight and the cards build on the held model (the eye\'s glow, pass 2 wave 2, last)');
  const ground = readFileSync(new URL('../../../src/core/gpu/gpuGround.ts', import.meta.url), 'utf8');
  ok((ground.match(/return new HeldLightingModel\(\);/g) ?? []).length === 1 && /export class GroundLightingModel extends \(HeldLightingModel as Any\)/.test(ground), "the ground's version 3 takes the held model, the tile program and the rings the ground's own on it");
}

// ---------------------------------------------------------------- 5. the fill kept apart
{
  const env: Any = {
    setup(builder: Any) {
      builder.context.irradiance.addAssign(vec3(0.25));
      builder.context.radiance.addAssign(vec3(0.5));
      return null;
    },
  };
  keepFillApart(env);
  // The record a first environment makes, stood in for so its additions are counted.
  const record = counted();
  const b = builderWith({ swgIblIrradiance: record });
  const ambient = b.context.irradiance;
  env.setup(b);
  ok(ambient.adds === 0 && b.context.irradiance === ambient && record.adds === 1 && b.context.radiance.adds === 1, "the environment's fill goes to the context's own record, the ambient's untouched and given back, its reflection where three puts it");
  env.setup(b);
  ok(b.context.swgIblIrradiance === record && record.adds === 2, 'and a second environment adds to the same record');
  const fresh: Any = { context: { irradiance: counted() } };
  const quiet: Any = { setup: () => null };
  keepFillApart(quiet);
  quiet.setup(fresh);
  ok(!!fresh.context.swgIblIrradiance && fresh.context.swgIblIrradiance.isNode === true, 'the first environment on a context makes the record (a variable of the program)');
  const node: Any = new MeshStandardNodeMaterial();
  node.envNode = vec3(1);
  lightHoldPart.apply(node, new THREE.MeshStandardMaterial());
  const e = node.setupEnvironment({ environmentNode: null });
  ok(e?.isLightingNode === true && Object.prototype.hasOwnProperty.call(e, 'setup'), "the part's copy keeps its environment's fill apart (its environment node's own setup is wrapped)");
}

console.log(`gpuLightHold: ${checks} checks passed`);
