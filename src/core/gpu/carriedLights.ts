// The lights the player carries, on WebGPU (the sky and light fix round, maker L): the effects' pooled flash lights (a lit
// blade's, the fighters' glows, shots, hits, powers) and the flashlight, each a light of three's whose node draws its direct
// light times the eye's compensation, as the blade's own glow is drawn (`eyeBuffer.ts`'s glow part on the emissives).
//
// Why: three lights a surface by a point or a spot light in the scene's own units, which the eye then exposes like every other
// light; at night the eye opens 15 to 17 stops, so the 2.2 the saber asks for reached the screen some 40,000 times brighter and
// his body and the ground near the blade or under the flashlight were white (23 to 31% of the investigator's frames clipped),
// while the blade itself, an emissive, kept its look through the glow factor. So each such light carries a flag (`carried`, 1
// a carried light, 0 a light a room is lit by: a ship's rooms take the same pool and light the room the eye adapts to) and its
// node multiplies its direct light by `exposure^(-share · flag)`, `share` the `exposure` set's Carried lights dial
// (`src/sky/eyeLights.ts`): at 1 a carried light lights a surface as it did at an exposure of 1 however far the eye opens; at
// 0, or with the flag at 0, the factor is exactly 1 and the light is three's own.
//
// The lights are three's `PointLight` and `SpotLight` with one field more, each class given its node by `registerNode` when
// this module loads (on `start.ts`'s import, before any material is built), so three's lighting walks them as its own: the
// light count, every light's id and its cast flag (three's key) are as before, nothing is built in play, and the flag and the
// dial are uniforms. A material that skips tone mapping (`toneMapped` false), drawn straight onto the canvas with the effects
// off, takes no exposure at all and so no compensation (the glow part's rule, `eyeGlowNode(true)`); the choice is made as the
// graph is built, by the material's `toneMapped`, which is in three's key.
//
// Nothing here is loaded on the WebGL path; the runtime hands the game its two makers (`GpuRuntime.carried`).
import * as THREE from 'three';
import { PointLightNode, SpotLightNode } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { eyeExposureNode } from '../../sky/exposure/eyeBuffer.ts';
import { EYE_LIGHTS } from '../../sky/eyeLights.ts';
import { toCanvasNode } from './inlineOutput.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { exp2, float, log2, max, renderGroup, select, uniform } = TSL as Any;

/** A point light that carries the eye's flag: 1 (a carried light) unless the pool hands it to a room's light. */
export class CarriedPointLight extends THREE.PointLight {
  carried = 1;
}

/** A spot light that carries the eye's flag (the flashlight: always 1). */
export class CarriedSpotLight extends THREE.SpotLight {
  carried = 1;
}

/** The Carried lights dial, read once a render in the shared render group. */
const SHARE: Any = uniform(EYE_LIGHTS.carried)
  .setGroup(renderGroup)
  .onRenderUpdate(() => EYE_LIGHTS.carried);

/** What the nodes have built, for the report. */
export const CARRIED_STATS = { pointBuilds: 0, spotBuilds: 0, untonedBuilds: 0 };

/**
 * The factor a carried light's direct light is drawn times: `exposure^(-share · flag)`, worked as `exp2(-log2(exposure) ·
 * share · flag)` so a flag of 0 is exactly 1. `raw`: the material skips tone mapping, so straight onto the canvas it takes 1.
 */
function factorNode(flag: Any, raw: boolean): Any {
  const f = exp2(log2(max(eyeExposureNode(), 1e-30)).mul(SHARE).mul(flag).negate());
  return raw ? select(toCanvasNode().greaterThan(0.5), float(1), f) : f;
}

/** Three's point light node with its direct light times the eye's compensation. */
class CarriedPointLightNode extends (PointLightNode as Any) {
  static get type(): string {
    return 'CarriedPointLightNode';
  }

  flagNode: Any;

  constructor(light: Any = null) {
    super(light);
    this.flagNode = uniform(1).setGroup(renderGroup);
  }

  update(frame: Any): void {
    super.update(frame);
    this.flagNode.value = (this as Any).light.carried === 0 ? 0 : 1;
  }

  setupDirect(builder: Any): Any {
    const d = super.setupDirect(builder);
    const raw = builder?.material?.toneMapped === false;
    CARRIED_STATS.pointBuilds++;
    if (raw) CARRIED_STATS.untonedBuilds++;
    return { ...d, lightColor: d.lightColor.mul(factorNode(this.flagNode, raw)) };
  }
}

/** Three's spot light node likewise. */
class CarriedSpotLightNode extends (SpotLightNode as Any) {
  static get type(): string {
    return 'CarriedSpotLightNode';
  }

  flagNode: Any;

  constructor(light: Any = null) {
    super(light);
    this.flagNode = uniform(1).setGroup(renderGroup);
  }

  update(frame: Any): void {
    super.update(frame);
    this.flagNode.value = (this as Any).light.carried === 0 ? 0 : 1;
  }

  setupDirect(builder: Any): Any {
    const d = super.setupDirect(builder);
    const raw = builder?.material?.toneMapped === false;
    CARRIED_STATS.spotBuilds++;
    if (raw) CARRIED_STATS.untonedBuilds++;
    return { ...d, lightColor: d.lightColor.mul(factorNode(this.flagNode, raw)) };
  }
}

// Each class its node, before any material is built (three reads a light's node class off its prototype as it first lights).
(CarriedPointLight as Any).registerNode(CarriedPointLightNode);
(CarriedSpotLight as Any).registerNode(CarriedSpotLightNode);

/** The runtime's makers: the effects' pool light and the flashlight. */
export const CARRIED_LIGHTS = {
  point(): THREE.PointLight {
    return new CarriedPointLight(0xffffff, 0, 1);
  },
  spot(color: number, intensity: number, distance: number, angle: number, penumbra: number, decay: number): THREE.SpotLight {
    return new CarriedSpotLight(color, intensity, distance, angle, penumbra, decay);
  },
  report(): Record<string, unknown> {
    return { share: EYE_LIGHTS.carried, ...CARRIED_STATS, by: "three's point and spot light nodes, the direct light times exposure^(-share · flag) (src/core/gpu/carriedLights.ts)" };
  },
};
