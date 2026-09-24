// Loading one of the baked places and standing it in the world's own scene.
//
// The converter's `scenes` command writes a place as a list of instances and a pool of models whose
// textures were taken down to the pixels the shot's fixed camera really covers. This reads that
// back. It is deliberately small: it knows how to fetch models, instance them and let go of them,
// and nothing about cameras, characters or screens.
//
// Three things about it are worth stating, because each is a rule the rest of the game already
// keeps and this had to keep as well.
//
// **Every loader is the animated-surfaces loader.** A converted model's flip-books and scrolls are
// `extras.swg` on its materials, and they only ever reach the game through
// `surfaces.withPlugin(new GLTFLoader())` -- a plain loader reads the model perfectly and silently
// drops every animation on it. See `src/world/surfaces.ts`.
//
// **A place is loaded once and then only shown or hidden.** The whole point of building three at a
// time is that changing between them costs nothing, so a place that has been built is kept until
// the screen is done with the lot of them.
//
// **What it builds goes in the world's own scene**, lit by the world's own lights, so the sun of
// the hour really falls on it. That is why the screens are three-dimensional at all, and it is also
// why the materials must go through the world's own adoption -- the shadow cascades are part of a
// program's key, and a material that skipped them would compile a second time on a live frame.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { surfaces } from './surfaces.ts';

/** One instance of one model, as the bake writes it: the place's own frame, feet at the origin. */
interface SceneInstance {
  /** `<pack>/<model>`, which is also where the file is. */
  m: string;
  p: [number, number, number];
  /** The snapshot's own quaternion order, w first, exactly as the pack carries it. */
  q: [number, number, number, number];
}

/** A place, as `scenes/<key>.json` holds it. */
export interface ScenePlace {
  key: string;
  pack: string;
  place: string | null;
  stand: { x: number; y: number; z: number; heading: number };
  camera: { x: number; y: number; z: number; look: { x: number; y: number; z: number }; fov: number };
  ship: { x: number; y: number; z: number; heading: number } | null;
  hours: { name: string; hour: number }[];
  instances: SceneInstance[];
  effects: SceneInstance[];
}

/** What `scenes/manifest.json` says the install has. */
export interface SceneManifest {
  format: number;
  builtFor: { aspect: number; fovPad: number; quality: number; cullPixels: number };
  creator: string[];
  places: { key: string; pack: string; instances: number; effects: number; models: number; dropped: number }[];
  packs: string[];
  models: number;
  bytes: number;
}

const ROOT = 'assets-private/scenes';
/** The format this build reads. A pack written by an older converter is refused rather than half-read. */
const READS_FORMAT = 1;

/**
 * The manifest, fetched once a session.
 *
 * A missing one is not an error and is not reported as one: it means nobody has run the `scenes`
 * command on this install, which is the ordinary state of a fresh checkout. Every screen that asks
 * must cope with null and fall back to what it did before.
 */
let manifestOnce: Promise<SceneManifest | null> | null = null;
export function sceneManifest(): Promise<SceneManifest | null> {
  manifestOnce ??= (async () => {
    try {
      const res = await fetch(`${ROOT}/manifest.json`);
      if (!res.ok) return null;
      const man = (await res.json()) as SceneManifest;
      if (man?.format !== READS_FORMAT || !Array.isArray(man.places) || !man.places.length) return null;
      return man;
    } catch {
      return null;
    }
  })();
  return manifestOnce;
}

/** A place that has been built: its group, and what it cost. */
export interface BuiltPlace {
  place: ScenePlace;
  group: THREE.Group;
  /** Distinct models fetched, draw calls built, triangles in them. */
  models: number;
  draws: number;
  triangles: number;
  /** Models the pack named and the fetch could not find, which are reported rather than hidden. */
  missing: string[];
}

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * Build one place.
 *
 * `adopt` is the world's own material adoption, which must run on every material **before anything
 * is compiled**: the shadow cascades put defines and a hook into a material, and both are part of
 * three's program key, so a material that reached a draw without them would build a second program
 * on a live frame. `breath` is the world's yield between pieces of work, so a long build does not
 * hold the frame.
 */
export async function buildPlace(
  key: string,
  deps: { adopt: (root: THREE.Object3D) => void; breath: () => Promise<void> },
): Promise<BuiltPlace | null> {
  let place: ScenePlace;
  try {
    const res = await fetch(`${ROOT}/${key}.json`);
    if (!res.ok) return null;
    place = (await res.json()) as ScenePlace;
  } catch {
    return null;
  }
  if (!place?.instances) return null;

  // The one loader that keeps a model's flip-books and scrolls. A plain GLTFLoader reads these
  // models perfectly and silently drops every animated surface on them.
  const loader = surfaces.withPlugin(new GLTFLoader());
  const wanted = new Map<string, SceneInstance[]>();
  for (const i of place.instances) {
    const list = wanted.get(i.m);
    if (list) list.push(i);
    else wanted.set(i.m, [i]);
  }

  const group = new THREE.Group();
  group.name = `scene:${key}`;
  const missing: string[] = [];
  let draws = 0;
  let triangles = 0;
  for (const [id, list] of wanted) {
    let root: THREE.Object3D;
    try {
      const gltf = await loader.loadAsync(`${ROOT}/models/${id}.glb`);
      root = gltf.scene;
    } catch {
      missing.push(id);
      continue;
    }
    // Each drawable of the model becomes one instanced mesh carrying every copy of it in the place.
    root.updateMatrixWorld(true);
    const prims: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) prims.push(m);
    });
    for (const prim of prims) {
      const mesh = new THREE.InstancedMesh(prim.geometry, prim.material, list.length);
      // The model's own transform inside its file is part of where a piece sits, so each instance
      // is the place's transform times the piece's own, never the place's alone.
      const local = prim.matrixWorld;
      list.forEach((inst, i) => {
        // The pack writes a quaternion w first, which is not three's order.
        tmpQ.set(inst.q[1], inst.q[2], inst.q[3], inst.q[0]);
        tmpM.compose(tmpV.set(inst.p[0], inst.p[1], inst.p[2]), tmpQ, ONE);
        tmpM.multiply(local);
        mesh.setMatrixAt(i, tmpM);
      });
      mesh.instanceMatrix.needsUpdate = true;
      // Nothing here moves, so three need never work a matrix out again.
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      draws++;
      const index = prim.geometry.getIndex();
      triangles += ((index ? index.count : prim.geometry.getAttribute('position')?.count ?? 0) / 3) * list.length;
    }
    // A breath per model, not per place: a place is hundreds of models and holding the frame for
    // all of them is the stall the whole game is built to avoid.
    await deps.breath();
  }

  deps.adopt(group);
  return { place, group, models: wanted.size - missing.length, draws, triangles: Math.round(triangles), missing };
}

/**
 * Let go of a built place.
 *
 * The geometry and materials came from this place's own files and are shared with nothing else, so
 * both are disposed. Whoever holds the world's material sets must be told first -- see
 * `World.forgetMaterials` -- since the portal renderer walks its set a dozen times a frame and the
 * cascades' map is a leak that shows as a stutter.
 */
export function disposePlace(built: BuiltPlace, forget: (materials: THREE.Material[]) => void): void {
  const materials: THREE.Material[] = [];
  built.group.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat) materials.push(mat);
  });
  forget(materials);
  built.group.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat?.dispose();
    if (m.isInstancedMesh) m.dispose();
  });
  built.group.removeFromParent();
  built.group.clear();
}
