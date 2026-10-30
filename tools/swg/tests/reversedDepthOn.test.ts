// Reversed depth on (docs/REVERSED-DEPTH.md): a browser offering EXT_clip_control is stood in before the flag is read,
// and every text chosen for reversed depth is checked turned round -- the companion of reversedDepth.test.ts, which
// checks them off. The stand-ins are taken away again before anything else is imported, so no other module sees them.
//
//   1. the flag: on with the extension, off with ?norevz, off without the extension
//   2. fxViewZ: its reversed formula gives back the distance three's reversed projection put in, near to far
//   3. the sky and far-end tests, and the grass's bias and far test, turned round
import assert from 'node:assert/strict';
import * as THREE from 'three';

let passed = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  passed++;
};

type Bag = Record<string, unknown>;
const g = globalThis as unknown as Bag;
const browser = (search: string, offersClipControl: boolean): void => {
  g.location = { search };
  g.document = {
    createElement: () => ({
      getContext: () => ({
        getExtension: (name: string) => (name === 'EXT_clip_control' ? (offersClipControl ? {} : null) : name === 'WEBGL_lose_context' ? { loseContext() {} } : null),
      }),
    }),
  };
};
const leave = (): void => {
  delete g.location;
  delete g.document;
};

// --- 1. the flag ---
browser('?planet=monument', true);
const { REVERSED_DEPTH } = await import('../../../src/core/depthMode.ts');
leave();
ok(REVERSED_DEPTH === true, 'on by default where the browser offers EXT_clip_control');
browser('?planet=monument&norevz', true);
ok((await import('../../../src/core/depthMode.ts?norevz')).REVERSED_DEPTH === false, '?norevz turns it off');
leave();
browser('', false);
ok((await import('../../../src/core/depthMode.ts?noext')).REVERSED_DEPTH === false, 'off where the browser has no EXT_clip_control, so no player gets shaders chosen for a depth they cannot have');
leave();

// The modules below read the flag imported first: on.
const { FX_LINEARIZE, skyTest, pastFarTest } = await import('../../../src/core/fx/glsl.ts');
const { GRASS_FRAGMENT, grassForDepthMode } = await import('../../../src/world/grass.ts');

// --- 2. fxViewZ against three's reversed projection ---
{
  ok(FX_LINEARIZE.includes('(near * far) / (near + depth * (far - near))') && !FX_LINEARIZE.includes('depth * 2.0 - 1.0'), 'fxViewZ is the reversed one');
  const near = 0.05;
  const far = 9000;
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, near, far);
  (camera as unknown as { _reversedDepth: boolean })._reversedDepth = true;
  camera.updateProjectionMatrix();
  const viewZ = (depth: number): number => (near * far) / (near + depth * (far - near)); // the shader's, in JS
  for (const metres of [0.05, 2, 50, 1500, 8999]) {
    const depth = new THREE.Vector3(0, 0, -metres).applyMatrix4(camera.projectionMatrix).z;
    ok(Math.abs(viewZ(depth) - metres) / metres < 1e-6, `${metres} m out: depth ${depth.toExponential(3)} reads back as ${viewZ(depth).toFixed(4)} m`);
  }
}

// --- 3. the tests turned round ---
{
  ok(skyTest('d') === 'd <= 0.0', 'the sky is a cleared depth of 0');
  ok(pastFarTest('sc.z') === 'sc.z < 0.0', 'past a shadow map\'s far end is below 0');
  const grass = grassForDepthMode(GRASS_FRAGMENT);
  ok(grass.includes('\tswgS.z -= uSwgGrassShadowBias[ swgI ];') && !grass.includes('swgS.z += uSwgGrassShadowBias'), 'the grass subtracts its shadow bias, as three does under reversed depth');
  ok(grass.includes('|| swgS.z < 0.0 ) return 1.0;') && !grass.includes('|| swgS.z > 1.0 ) return 1.0;'), "the grass's far test is below 0");
  ok(GRASS_FRAGMENT.includes('swgS.z += uSwgGrassShadowBias'), 'and the grass\'s own text, as the file holds it, is untouched');
}

console.log(`\nreversedDepthOn: ${passed} checks passed`);
process.exit(0);
