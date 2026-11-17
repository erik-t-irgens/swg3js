// The sun's cascaded shadows on WebGPU (the GPU port's step 3): one directional light with three's `CSMShadowNode`,
// standing in for the classic cascades' three lights, which the world keeps (every reader of the cascades still reads
// them) and hides from the WebGPU renderer.
//
// The classic cascades (`CSM.js`) are still made and updated each frame on WebGPU: the world reads their breaks, boxes and
// direction everywhere. This sun copies from them every frame: the direction (`lightDirection`), the colour and intensity
// of their first light (all three carry the same), the shadow's darkness, and each cascade's bias, normal bias, softness
// (`radius`) and depth range onto the matching cascade light three's node made (they are clones of the sun's shadow made
// once, so a later write to the sun's own shadow would never reach them). The splits are the game's own
// (`shadowSplits.ts` through `customSplitsCallback`), the reach the shadow distance, the map the setting's size.
//
// Three's own bias applies on WebGPU: the sun-shadow-bias hold (`threeHolds.ts`) is a WebGL chunk's and has no node twin.
// The cascades are fitted to the game's camera, handed over at once (`_init`), so a pass drawn with another camera (a
// preview's, a compile's) never fits them to itself.

import * as THREE from 'three';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { reference, renderGroup } from 'three/tsl';
import { leafBiasNode } from './gpuCard.ts';
import { LOOKS_AT_LOAD } from './looks.ts';
import type { GpuSun, GpuSunOptions } from '../gpuSwitch.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** How far the sun stands back from its target along its direction: any distance, a directional light's place is its direction. */
const SUN_BACK = 100;

export function makeSun(renderer: Any, scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: GpuSunOptions): GpuSun {
  const light = new THREE.DirectionalLight(0xffffff, 0);
  light.name = 'gpu sun';
  // The one light the leaf cards take as the sun (`gpuCard.ts`): its direction and its cascades' shadow feed their sum.
  light.userData.swgSun = true;
  light.castShadow = true;
  light.shadow.mapSize.set(opts.mapSize, opts.mapSize);
  const node: Any = new CSMShadowNode(light, { cascades: 3, maxFar: opts.maxFar, mode: 'custom', customSplitsCallback: opts.splits, lightMargin: opts.lightMargin });
  // The cascades fade into each other, as the classic cascades do (`csm.fade = true` in the world).
  node.fade = true;
  (light.shadow as Any).shadowNode = node;
  scene.add(light, light.target);
  // The node reads the camera's projection as reversed when the renderer draws reversed, and three turns a camera reversed
  // only at its first draw: fitted before that, every cascade's box came out of a projection read the wrong way round
  // (14.6 km, 0.1 m and 0.3 m, and the near ground all in shadow). Turned now, as the renderer would, then fitted.
  if (renderer.reversedDepthBuffer === true && camera.reversedDepth !== true) {
    (camera as Any)._reversedDepth = true;
    camera.updateProjectionMatrix();
  }
  if (typeof node._init === 'function') node._init({ camera, renderer });
  // Each cascade's bias raised by the leaf cards' acne floor where a card asks for it (`gpuCard.ts`, step 4): nought, and so
  // the cascade's own bias to the bit, in every other material's lookup. Only with the leaf cards' part taken in at load.
  if (LOOKS_AT_LOAD.card) for (const l of node.lights as { shadow: Any }[]) l.shadow.biasNode = leafBiasNode(reference('bias', 'float', l.shadow).setGroup(renderGroup));
  let fittedReversed = camera.reversedDepth === true;
  const sun: GpuSun = {
    light,
    sync(cascades, cam, castShadow) {
      const lights = cascades.lights;
      const first = lights[0];
      if (first) {
        light.color.copy(first.color);
        light.intensity = first.intensity;
        light.shadow.intensity = first.shadow.intensity;
      }
      light.castShadow = castShadow;
      // The light at the camera, standing back along the direction the light comes from.
      light.target.position.copy(cam.position);
      light.position.copy(cam.position).addScaledVector(cascades.lightDirection, -SUN_BACK);
      // The reach moved (the shadow distance), or the camera's projection turned since the fit: the cascades fitted again.
      if (node.maxFar !== cascades.maxFar || (cam.reversedDepth === true) !== fittedReversed) {
        node.maxFar = cascades.maxFar;
        fittedReversed = cam.reversedDepth === true;
        if (node.camera) node.updateFrustums();
      }
      const own = node.lights as { shadow: THREE.DirectionalLightShadow }[];
      for (let i = 0; i < own.length && i < lights.length; i++) {
        const from = lights[i].shadow;
        const to = own[i].shadow;
        to.bias = from.bias;
        to.normalBias = from.normalBias;
        to.radius = from.radius;
        to.intensity = from.intensity;
        if (to.mapSize.x !== from.mapSize.x) to.mapSize.copy(from.mapSize);
        const fc = from.camera;
        const tc = to.camera;
        if (tc.near !== fc.near || tc.far !== fc.far) {
          tc.near = fc.near;
          tc.far = fc.far;
          tc.updateProjectionMatrix();
        }
      }
    },
    frustums() {
      if (node.camera) node.updateFrustums();
    },
    describe() {
      const own = (node.lights ?? []) as { position: THREE.Vector3; shadow: THREE.DirectionalLightShadow }[];
      return {
        intensity: Number(light.intensity.toFixed(3)),
        castShadow: light.castShadow,
        direction: light.target.position.clone().sub(light.position).normalize().toArray().map((v) => Number(v.toFixed(3))),
        maxFar: node.maxFar,
        breaks: (node.breaks as number[]).map((b) => Number(b.toFixed(4))),
        fade: node.fade,
        cascades: own.map((l) => {
          const c = l.shadow.camera;
          return { box: Number((c.right - c.left).toFixed(1)), near: c.near, far: Number(c.far.toFixed(1)), bias: Number(l.shadow.bias.toFixed(6)), normalBias: Number(l.shadow.normalBias.toFixed(4)), radius: l.shadow.radius, mapSize: l.shadow.mapSize.x, map: !!(l.shadow as unknown as { map: unknown }).map };
        }),
      };
    },
    node,
    dispose() {
      node.dispose?.();
      light.removeFromParent();
      light.target.removeFromParent();
      light.dispose();
    },
  };
  return sun;
}
