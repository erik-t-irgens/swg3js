// The shadow pass's own scene and the rooms' own scene (the performance pass's second wave): two stand-ins for the
// world's one scene, so that each pass three draws keeps a light set of its own.
//
// Three keeps a render state -- the lights it gathered and a version number for them -- per scene object it is handed
// (`renderStates.get(scene, depth)`), and moves the version whenever a pass's light counts differ from the last pass
// drawn with that scene; every lit material whose recorded version differs then works its program key out again before
// it draws. The shadow pass (whose probe sees every layer, the world's lights and the rooms' at once), the world pass
// and a building's rooms pass all drew the one world scene, so the version moved three times a frame and some 377 lit
// materials chose their program again every frame for nothing: about 5 ms of a Bestine frame. Here the shadow pass and
// every rooms pass draw through a proxy of their own, whose `children` **is** the world scene's own array (never added
// to, so nothing is ever reparented and every child keeps the world scene as its parent), and the world pass keeps the
// real scene. Each keeps one light set for good, and a depth program, which three keys on the light set of the last
// pass drawn with the scene it is drawn under (it draws the shadow maps before it sets up the lights of the pass that
// asked for them), is keyed on the shadow pass's own set and never on a room's.
//
// A proxy must look exactly like the scene to everything three reads off a scene, on every draw: what `render` and
// `getProgram` read (the background and the override, the fog and the environment) and the walk's own switch. Pure but
// for three; node loads it (`passScenes.test.ts`).
import * as THREE from 'three';

/**
 * Every field a `THREE.Scene` holds of its own beyond an `Object3D`'s, as three 0.185 has them (the test works the list
 * out afresh from three itself, so a field three adds later fails it until it is mirrored here). `isScene` is the same
 * on both and is left out.
 */
export const SCENE_FIELDS = ['background', 'backgroundBlurriness', 'backgroundIntensity', 'backgroundRotation', 'environment', 'environmentIntensity', 'environmentRotation', 'fog', 'overrideMaterial'] as const;

/**
 * The switch: `perPass` draws the shadow pass and every rooms pass through their own proxies (what ships, from the first
 * loading screen); `shared` draws every pass through the one world scene, as before, for comparing in one session
 * (`__debug.perf({ ab: { key: 'renderStates' } })`). Flipped live, the set the depth programs are keyed on moves and
 * about a dozen are built on live frames once; it is a comparing switch and nothing else.
 */
export const PASS_STATES: { mode: 'shared' | 'perPass' } = { mode: 'perPass' };

/** A scene as the mirror reads and writes it: by field name. */
type SceneFields = Record<(typeof SCENE_FIELDS)[number], unknown>;

/**
 * Make `proxy` look like `real` to three: every scene field (by reference), whether its matrices are walked, and
 * whether it is shown. Called on every draw through a proxy, since the fog, the environment and the walk's switch all
 * move during a frame (`PortalRenderer.matrixOnce` turns the walk off after the first pass that takes the scene).
 * Nothing allocated.
 */
export function mirror(real: THREE.Scene, proxy: THREE.Scene): void {
  const from = real as unknown as SceneFields;
  const to = proxy as unknown as SceneFields;
  for (let i = 0; i < SCENE_FIELDS.length; i++) {
    const k = SCENE_FIELDS[i];
    to[k] = from[k];
  }
  // The walk exactly as the real scene's: a scene that updates its own (identity) matrix forces every descendant's
  // world matrix to be worked out again, which is what the world's draws have always had and some writers lean on.
  proxy.matrixAutoUpdate = real.matrixAutoUpdate;
  proxy.matrixWorldAutoUpdate = real.matrixWorldAutoUpdate;
  proxy.visible = real.visible;
}

export class PassScenes {
  /** What the shadow pass draws through (its probe sees every layer, so its set is every light at once). */
  readonly shadow = new THREE.Scene();
  /** What every building's rooms pass draws through (the rooms' layer and the actors'). */
  readonly rooms = new THREE.Scene();
  /** The scene the proxies stand in for now, or null before the first draw. */
  private real: THREE.Scene | null = null;
  /** An empty group compiled to set a proxy's lights up (`prime`). Kept, never added to anything. */
  private readonly nothing = new THREE.Group();

  constructor() {
    // Never transformed: a proxy's own matrix stays the identity its children's parent (the real scene) has.
    this.shadow.name = 'the shadow pass';
    this.rooms.name = 'the rooms passes';
  }

  /**
   * Stand for `real`: both proxies take its very `children` array, so whatever is added to or taken out of the world
   * scene is in both at once, and nothing is ever parented to a proxy. Answers at once when it already stands for it.
   */
  bind(real: THREE.Scene): void {
    if (this.real === real && this.shadow.children === real.children && this.rooms.children === real.children) return;
    this.real = real;
    (this.shadow as { children: THREE.Object3D[] }).children = real.children;
    (this.rooms as { children: THREE.Object3D[] }).children = real.children;
  }

  /** The scene the shadow pass draws with: its proxy, mirrored now (the real scene with the switch on `shared`). */
  forShadows(real: THREE.Scene): THREE.Scene {
    if (PASS_STATES.mode !== 'perPass') return real;
    this.bind(real);
    mirror(real, this.shadow);
    return this.shadow;
  }

  /** The scene a rooms pass draws with: its proxy, mirrored now (the real scene with the switch on `shared`). */
  forRooms(real: THREE.Scene): THREE.Scene {
    if (PASS_STATES.mode !== 'perPass') return real;
    this.bind(real);
    mirror(real, this.rooms);
    return this.rooms;
  }

  /**
   * Set each proxy's lights up once, by a compile of nothing under its own camera and layers (`renderer.compile`
   * gathers the target scene's lights and sets them up): done at every loading screen's sweep, so the first frame's
   * shadow pass never keys a depth program on an empty light set (it draws the shadow maps before it sets up its own
   * pass's lights). `probe` sees every layer; `camera`'s layers are set to `roomsMask` for the rooms' compile and put
   * back. A compile builds no program for an empty group.
   */
  prime(renderer: THREE.WebGLRenderer, real: THREE.Scene, probe: THREE.Camera, camera: THREE.Camera, roomsMask: number): void {
    if (PASS_STATES.mode !== 'perPass') return;
    renderer.compile(this.nothing, probe, this.forShadows(real));
    const mask = camera.layers.mask;
    camera.layers.mask = roomsMask;
    try {
      renderer.compile(this.nothing, camera, this.forRooms(real));
    } finally {
      camera.layers.mask = mask;
    }
  }
}
