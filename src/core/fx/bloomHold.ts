// The bloom's blur as three 0.185 drew it.
//
// Three 0.187's `UnrealBloomPass` takes its blur's taps two at a time: each pair of neighbouring texels is read
// as one bilinear fetch placed between them by their weights. Reading a level of its own size that is the same
// sum, but four of the pass's five levels read a level twice their size, where a fetch between two taps is not
// the two taps' weighted sum (the picture's own bilinear knots lie between them), so the glow's shape moved by a
// little. The game's bloom is three's pass, so this keeps 0.185's blur: one fetch a texel, at 0.185's weights,
// through the one method the pass makes its blur materials with. Everything else of the pass is 0.187's.
//
// The method's text below is three 0.185.1's own (`examples/jsm/postprocessing/UnrealBloomPass.js`, MIT:
// `LICENSES/three-MIT.txt`). `tools/swg/tests/threeAnchors.test.ts` holds that three's pass still makes its blur
// materials through a method of this name, called from its constructor, or this would hold nothing in silence.

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** The method three's pass makes each level's blur material with; an override of it is what holds the blur. */
export const BLOOM_BLUR_METHOD = '_getSeparableBlurMaterial';

/** Three 0.185.1's blur material for a kernel of this many taps a side: a Gaussian of a third its radius, one fetch a tap. */
export function bloomBlurMaterial185(kernelRadius: number): THREE.ShaderMaterial {
  const coefficients: number[] = [];
  const sigma = kernelRadius / 3;

  for (let i = 0; i < kernelRadius; i++) {
    coefficients.push((0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma);
  }

  return new THREE.ShaderMaterial({
    defines: {
      KERNEL_RADIUS: kernelRadius,
    },

    uniforms: {
      colorTexture: { value: null },
      invSize: { value: new THREE.Vector2(0.5, 0.5) }, // inverse texture size
      direction: { value: new THREE.Vector2(0.5, 0.5) },
      gaussianCoefficients: { value: coefficients }, // precomputed Gaussian coefficients
    },

    vertexShader: /* glsl */ `

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,

    fragmentShader: /* glsl */ `

				#include <common>

				varying vec2 vUv;

				uniform sampler2D colorTexture;
				uniform vec2 invSize;
				uniform vec2 direction;
				uniform float gaussianCoefficients[KERNEL_RADIUS];

				void main() {

					float weightSum = gaussianCoefficients[0];
					vec3 diffuseSum = texture2D( colorTexture, vUv ).rgb * weightSum;

					for ( int i = 1; i < KERNEL_RADIUS; i ++ ) {

						float x = float( i );
						float w = gaussianCoefficients[i];
						vec2 uvOffset = direction * invSize * x;
						vec3 sample1 = texture2D( colorTexture, vUv + uvOffset ).rgb;
						vec3 sample2 = texture2D( colorTexture, vUv - uvOffset ).rgb;
						diffuseSum += ( sample1 + sample2 ) * w;

					}

					gl_FragColor = vec4( diffuseSum, 1.0 );

				}`,
  });
}

/** Three's bloom pass with 0.185's blur. Its constructor asks this object for each level's blur material. */
export class HeldBloomPass extends UnrealBloomPass {
  _getSeparableBlurMaterial(kernelRadius: number): THREE.ShaderMaterial {
    return bloomBlurMaterial185(kernelRadius);
  }
}
