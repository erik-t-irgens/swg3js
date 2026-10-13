// The studio the previews' metal reflects: the wardrobe's doll, the select screen and the creator
// (`CharacterPreview`), and the ship edit page (`ShipPreview`). Each draws the world's own materials in a
// WebGL context of its own, where the world's filtered sky is nothing, so each makes this once and swaps
// it onto what it draws around its own draws (`EnvironmentSwap` in `envmap.ts`).
//
// Filtered from a 128 px cube, as every environment the world hands its materials is (the sky's captures
// and the black stand-in): the environment's height is in three's program key, so a program a preview
// compiles is keyed exactly as one compiled with the world's environment still on the material would be.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MODEL_REFLECTIONS_AT_LOAD, takesEnvironment } from '../world/envmap.ts';

/** The cube the studio is filtered from: the world's own size (`World.refreshEnvironment`, `WaterBodies`). */
export const STUDIO_CUBE = 128;

/** A neutral lit room, filtered for reflections in this renderer's own context. The caller keeps and frees the target. */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target = pmrem.fromScene(room, 0.04, 0.1, 100, { size: STUDIO_CUBE });
  room.dispose();
  pmrem.dispose();
  return target;
}

/**
 * Which studio a doll's draw hands over (`CharacterPreview`): the one it made, once it has made one. Until then it
 * asks once a model and not once a frame, since each change of dress is a new clone and a figure first seen in plain
 * cloth may put on armour, and makes one (`make`, called at most once) only for a model with something a studio
 * would go on (a shader with a cube) and only while the load-time hatch lets the models reflect at all. A doll with
 * nothing to give a studio to therefore never makes one, and never walks its figure more than once a clone to know.
 */
export class StudioChoice {
  private target: THREE.WebGLRenderTarget | null = null;
  private askedOf: THREE.Object3D | null = null;
  private readonly make: () => THREE.WebGLRenderTarget;
  private readonly atLoad: boolean;

  constructor(make: () => THREE.WebGLRenderTarget, atLoad = MODEL_REFLECTIONS_AT_LOAD) {
    this.make = make;
    this.atLoad = atLoad;
  }

  /** The studio's texture for a draw of `model`, or null when there is nothing to give one to. */
  textureFor(model: THREE.Object3D): THREE.Texture | null {
    if (this.target) return this.target.texture;
    if (this.askedOf === model) return null;
    this.askedOf = model;
    if (!this.atLoad || !takesEnvironment(model)) return null;
    this.target = this.make();
    return this.target.texture;
  }

  /** Whether the studio has been made, for the console. */
  get made(): boolean {
    return this.target !== null;
  }
}
