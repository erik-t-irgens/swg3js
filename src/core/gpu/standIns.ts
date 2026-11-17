// The stand-ins this step draws on WebGPU for programs of ours three cannot draw (the GPU port's step 3): the plain look,
// never the faithful one (that is steps 4 to 6, and for the sky and the water a remake of the owner's).
//
// Each is a node material whose uniforms read the site's own live objects (a `THREE.Color` the WebGL path writes every
// frame is handed over as it is, and three's uniform reads it each frame), so a stand-in follows the hour and the look
// with nothing written to it. The pipeline's state is the original material's (the fallback hands the stand-in back
// from `fromMaterial`), so only colour, opacity, the vertex place and the depth are a stand-in's own. Every number of
// look is a dial in `GPU_LOOK` (`gpuLook.ts`), read live.
//
// The water needs none: its material is a classic `MeshPhysicalMaterial` with a hook of ours, and three's node copy of it
// is already a flat surface in its look's colour and opacity (the hook, which WebGPU does not run, carries the waves).

import * as THREE from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, NodeMaterial } from 'three/webgpu';
import { attribute, float, mix, normalize, positionGeometry, positionLocal, renderGroup, smoothstep, uniform, vec3, vec4, vertexColor } from 'three/tsl';
import type { GpuStandIns, LiveColour } from '../gpuSwitch.ts';
import { GPU_LOOK } from './gpuLook.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A colour the WebGL path keeps, as three's colour uniform: the very object, so its writes reach the picture. In the shared
 * render group, written once a render: in three's object group a uniform is written only when its object is first drawn or
 * its material or matrix moves, so a mesh that stands still (the dome's copy the sky's capture draws, a lava flow) kept the
 * colour of its first draw for good (the GPU port's step 4 found it: every reflection on WebGPU was the first capture's sky).
 */
const colour = (c: LiveColour): Any => uniform(c as THREE.Color).setGroup(renderGroup);
/** A dial read once a render, in the shared render group for the same reason. */
const dial = (read: () => number): Any => uniform(read()).setGroup(renderGroup).onRenderUpdate(read);

export function makeStandIns(): GpuStandIns {
  return {
    sky(horizon, zenith) {
      const m = new MeshBasicNodeMaterial();
      m.name = 'gpu stand-in: sky';
      m.fog = false;
      // The dome is a sphere about the camera, so its local direction is the view's: up its elevation from the horizon
      // colour to the zenith's, over the share of the way up the dial says.
      const up = dial(() => GPU_LOOK.skyZenithAt);
      const elev = normalize(positionLocal).y;
      m.colorNode = mix(colour(horizon), colour(zenith), smoothstep(float(0), up, elev));
      return m;
    },
    lava(c) {
      const m = new MeshBasicNodeMaterial();
      m.name = 'gpu stand-in: lava';
      const glow = dial(() => GPU_LOOK.lavaGlow);
      m.colorNode = colour(c).mul(glow);
      return m;
    },
    ground(source) {
      // The ground's tile program, which WebGPU does not run, drawn plain: each vertex's own colour-map colour where the
      // chunk carries one (the tile chunks' `aGroundTint`, the colour map's sRGB bytes at the vertex's pole; the plain
      // ground's vertex colours), else a mid grey, lit by the sun and the sky.
      const m = new MeshStandardNodeMaterial();
      m.name = 'gpu stand-in: ground';
      m.roughness = 1;
      m.metalness = 0;
      const grey = dial(() => GPU_LOOK.groundGrey);
      const shade = dial(() => GPU_LOOK.groundTint);
      m.colorNode = source === 'tint' ? attribute('aGroundTint', 'vec3').pow(vec3(2.2)).mul(shade) : source === 'color' ? vertexColor().rgb : vec3(grey, grey, grey);
      m.roughnessNode = float(1);
      m.metalnessNode = float(0);
      m.emissiveNode = vec3(0);
      return m;
    },
    depthReset(reversed) {
      // The doorway's depth reset: a full-screen triangle standing inside the clip range whose fragments write the far
      // depth (0 under reversed depth, 1 otherwise), where the original's stencil test passes. No colour (the original's
      // `colorWrite` is false and is what the pipeline reads).
      const m = new NodeMaterial();
      m.name = 'gpu stand-in: depth reset';
      m.vertexNode = vec4(positionGeometry.xy, float(0.5), float(1));
      m.depthNode = float(reversed ? 0 : 1);
      m.colorNode = vec4(vec3(0), float(0));
      return m;
    },
  };
}
