// A moon's or a planet's card under our sky on WebGPU (the GPU port's pass 2, wave 4a; the design's 2.5): the material it is
// hung with until the air's tables exist, and the record the world hands the drawing (`skyBody.ts`). Three's core only, so
// the sky (`src/world/sky.ts`, which the WebGL path loads) makes its cards with it and nothing of three's WebGPU build is
// reached; on WebGL and under SWG's sky no card is made and every body is its flat picture as it always was.
//
// The card's material is a `ShaderMaterial` three's WebGPU renderer cannot draw and has, at first, no stand-in for: the
// fallback steps over it unbuilt (`src/core/gpu/fallback.ts`), so a frame drawn behind the loading screen before the air is
// made builds nothing of it (the dome's way, `SwgSky.airReady`). `skyBody.ts` names its stand-in once the tables exist, as
// the sky is built. Its blend is premultiplied over (one and one less the alpha), its alpha nought today: a body adds its
// light to the sky behind it, as SWG's pictures added theirs (the blend kept so a body that covers what stands behind it is
// a graph's change, not a pipeline's).
import * as THREE from 'three';
import type { BodyAir } from './bodyAir.ts';

/** The two forms' text: never compiled (WebGPU draws the stand-in; WebGL never makes a card), apart so three keys them apart. */
const CARD_VERT = 'void main() { gl_Position = vec4(0.0); }';
const CARD_FRAG = { painted: 'void main() { gl_FragColor = vec4(0.0); } // sky body: painted', scattered: 'void main() { gl_FragColor = vec4(0.0); } // sky body: scattered' };

/** A card's material: its picture held for the drawing, its form in its text, blended premultiplied over, no depth written. */
export function bodyCardMaterial(map: THREE.Texture, form: 'painted' | 'scattered'): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: CARD_VERT,
    fragmentShader: CARD_FRAG[form],
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  m.name = `sky body (${form})`;
  // Unlit: kept out of the shadow cascades (whose defines are in a program's key) and the wetness, as the flat pictures were.
  m.userData.unlit = true;
  m.userData.swgBodyMap = map;
  return m;
}

/** One body of a sky (the sky makes it; the drawing reads it): its card, SWG's glow picture beside it, what it shows. */
export interface SkyBodyCard {
  /** The card the sky places each frame (its place, turn, size, opacity and whether it is up, as the flat picture's were). */
  readonly disc: THREE.Mesh;
  /** SWG's painted halo of it, or null: the Painted form's own layer. */
  readonly glow: THREE.Mesh | null;
  /** Its picture's file, and its picture. */
  readonly file: string;
  readonly map: THREE.Texture;
  /** What it shows (`bodyOfPicture`): a ground world, a giant, a temperate world or a moon. */
  readonly air: BodyAir;
  /** The sky's slot it rides in: the moon's, the second moon's, or an extra body fixed in the sky. */
  readonly slot: 'moon' | 'moon2' | 'celestial';
}
