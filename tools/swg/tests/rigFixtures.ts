// What the shuttle rig tests share: a rig made up here with the transport's own awkward rest turn, a
// second made-up rig whose clips can be flown (a take-off that climbs out nose first and a landing that
// glides in, each with a stretch no body could fly), and a reader of the game's own converted rigs.
//
// Not a test itself: `rigHull.test.ts`, `rigPath.test.ts` and `shuttleRide.test.ts` import it.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { readGlb } from '../glbclips.mjs';
import type { RigClips, TravelRig } from '../../../src/world/travelTerminal.ts';

export type Skeleton = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
export type Pieces = { joint: string; model: THREE.Object3D }[];

// The transport's own trick: its root joint rests turned 180 degrees about (-1, 0, 1)/√2 and its hull
// joint turns back again, so the hull stands level while the root's own axes point anywhere but where
// they look. A strut on the root slides, a door on the root swings, and the root carries the ship.
export const ROOT_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 1).normalize(), Math.PI);
/** Where the root rests, which is where the hull joint stands parked. */
export const ROOT_REST = new THREE.Vector3(0, 3.94, -3.82);

const P = (name: string, times: number[], values: number[]) => new THREE.VectorKeyframeTrack(`${name}.position`, times, values);
const Q = (name: string, times: number[], values: number[]) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);

/** The bones every made-up rig here has: the root, the hull joint turned back under it, a strut and a door. */
function bones(): THREE.Group {
  const scene = new THREE.Group();
  const root = new THREE.Bone();
  root.name = 'root';
  root.position.copy(ROOT_REST);
  root.quaternion.copy(ROOT_TURN);
  const hullJoint = new THREE.Bone();
  hullJoint.name = 'hold';
  hullJoint.quaternion.copy(ROOT_TURN).invert();
  const strut = new THREE.Bone();
  strut.name = 'hold_strut';
  strut.position.set(-6, 1.5, 0);
  strut.quaternion.copy(ROOT_TURN).invert();
  const door = new THREE.Bone();
  door.name = 'hold_door';
  door.position.set(-9, 2.4, -3.7);
  door.quaternion.copy(ROOT_TURN).invert();
  root.add(hullJoint, strut, door);
  scene.add(root);
  return scene;
}

const back = () => ROOT_TURN.clone().invert().toArray();
const opened = () => ROOT_TURN.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.68)).toArray();
/** Every joint keyed in every clip, the hull joint constant at its rest, as the converter writes them. */
const still = (d: number) => [P('hold', [0, d], [0, 0, 0, 0, 0, 0]), Q('hold', [0, d], [...back(), ...back()])];

/** The made-up rig of `rigHull.test.ts`: a landing, a take-off and a parked pose, for the swap's vertex checks. */
export function madeUpRig(): Skeleton {
  const scene = bones();
  const r = ROOT_TURN.toArray();
  const b = back();
  const open = opened();
  const climb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.4).multiply(ROOT_TURN).toArray();
  return {
    scene,
    animations: [
      new THREE.AnimationClip('land', 10, [
        P('root', [0, 6, 10], [80, 300, 900, 0, 60, 120, 0, 3.94, -3.82]),
        Q('root', [0, 10], [...r, ...r]),
        ...still(10),
        P('hold_strut', [0, 7, 10], [-6, 2.5, 0, -6, 2.5, 0, -6, 1.5, 0]),
        Q('hold_strut', [0, 10], [...b, ...b]),
        P('hold_door', [0, 10], [-9, 2.4, -3.7, -9, 2.4, -3.7]),
        Q('hold_door', [0, 8, 10], [...b, ...b, ...open]),
      ]),
      new THREE.AnimationClip('take_off', 6, [
        P('root', [0, 2, 6], [0, 3.94, -3.82, 0, 12, -10, 0, 90, -300]),
        Q('root', [0, 2, 6], [...r, ...r, ...climb]),
        ...still(6),
        P('hold_strut', [0, 2, 6], [-6, 1.5, 0, -6, 2.5, 0, -6, 2.5, 0]),
        Q('hold_strut', [0, 6], [...b, ...b]),
        P('hold_door', [0, 6], [-9, 2.4, -3.7, -9, 2.4, -3.7]),
        Q('hold_door', [0, 1, 6], [...open, ...b, ...b]),
      ]),
      new THREE.AnimationClip('loop_ground', 1 / 30, [
        P('root', [0, 1 / 30], [0, 3.94, -3.82, 0, 3.94, -3.82]),
        Q('root', [0, 1 / 30], [...r, ...r]),
        ...still(1 / 30),
        P('hold_strut', [0, 1 / 30], [-6, 1.5, 0, -6, 1.5, 0]),
        Q('hold_strut', [0, 1 / 30], [...b, ...b]),
        P('hold_door', [0, 1 / 30], [-9, 2.4, -3.7, -9, 2.4, -3.7]),
        Q('hold_door', [0, 1 / 30], [...open, ...open]),
      ]),
    ],
  };
}

export const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Group => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(x, y, z), new THREE.MeshStandardMaterial());
  g.add(m);
  return g;
};

export const madeUpPieces = (): Pieces => [
  { joint: 'hold', model: box(15, 11, 43, 0, 2, 0.8) },
  { joint: 'hold_strut', model: box(1.8, 2, 4, 0, -1, 0) },
  { joint: 'hold_door', model: box(3.5, 0.2, 2, 1.75, 0, 0) },
];

export const madeUpRigBlock: TravelRig = {
  file: 'travel/rig.glb',
  parts: [
    { joint: 'hold', file: 'travel/hull.glb', bounds: { min: [7.5, 7.5, 22.3], max: [-7.5, -3.5, -20.7] } },
    { joint: 'hold_strut', file: 'travel/strut.glb', bounds: { min: [-0.9, -2, -2], max: [0.9, 0, 2] } },
    { joint: 'hold_door', file: 'travel/door.glb', bounds: { min: [0, -0.1, -1], max: [3.5, 0.1, 1] } },
  ],
  moods: { '': { land: 'land', lift: 'take_off', ground: 'loop_ground' } },
  seconds: { land: 10, take_off: 6, loop_ground: 1 / 30 },
};

/**
 * How long the flyable rig's take-off and landing are, where its take-off leaps off at a speed no body
 * can fly, where its landing starts gliding in, and how far (degrees) its nose pitches up by the leap and
 * down as the glide begins.
 */
export const FLYING = { lift: 11, land: 12, leap: 10, glide: 0.5, liftPitch: 10, landPitch: 12 };

/** The root's rest turn pitched nose up by `deg` (down for a negative one): the hull joint under it pitches by exactly that. */
const pitchedRoot = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-deg)).multiply(ROOT_TURN).toArray();

/**
 * A made-up rig whose clips can be flown: the same bones, and a take-off that climbs out at 14 degrees,
 * speeding up at ten metres a second squared to a hundred metres a second at ten seconds while its nose
 * pitches steadily up to 10 degrees, then leaps kilometres in half a second; and a landing that comes in
 * from twenty kilometres out in half a second and then glides the rest of the way down a 14-degree slope,
 * slowing to a stop on the pad, its nose 12 degrees down as the glide begins and levelling out steadily
 * onto the ground. The hull joint turns with the root (the root's rest turn pitched), so the offset from
 * the hull joint to the vehicle's origin turns in flight and the pad's turn and the joint's own are two
 * different turns, as on the game's own rigs. The struts fold and the door shuts in the take-off's first
 * two seconds, and the landing opens them in its last two; the sky pose has them folded and shut. Keyed
 * every tenth of a second.
 */
export function flyingRig(): { skeleton: Skeleton; pieces: Pieces; block: TravelRig; clips: RigClips } {
  const scene = bones();
  const r = ROOT_TURN.toArray();
  const b = back();
  const open = opened();
  const rest = ROOT_REST;
  const liftT: number[] = [];
  const liftP: number[] = [];
  const liftQ: number[] = [];
  for (let t = 0; t <= FLYING.leap + 1e-9; t += 0.1) {
    const z = 5 * t * t;
    liftT.push(Number(t.toFixed(4)));
    liftP.push(rest.x, rest.y + 0.25 * z, rest.z + z);
    liftQ.push(...pitchedRoot((FLYING.liftPitch * Math.min(t, FLYING.leap)) / FLYING.leap));
  }
  liftT.push(FLYING.leap + 0.5, FLYING.lift);
  liftP.push(rest.x, rest.y + 0.25 * 2000, rest.z + 2000, rest.x, rest.y + 0.25 * 3000, rest.z + 3000);
  liftQ.push(...pitchedRoot(FLYING.liftPitch), ...pitchedRoot(FLYING.liftPitch));
  const landT: number[] = [0];
  const landP: number[] = [rest.x, rest.y + 5000, rest.z - 20000];
  const landQ: number[] = [...pitchedRoot(-FLYING.landPitch)];
  for (let t = FLYING.glide; t <= FLYING.land + 1e-9; t += 0.1) {
    const tau = Math.max(0, FLYING.land - t);
    landT.push(Number(t.toFixed(4)));
    landP.push(rest.x, rest.y + tau * tau, rest.z - 4 * tau * tau);
    landQ.push(...pitchedRoot((-FLYING.landPitch * tau) / (FLYING.land - FLYING.glide)));
  }
  const L = FLYING.lift;
  const D = FLYING.land;
  const skeleton: Skeleton = {
    scene,
    animations: [
      new THREE.AnimationClip('take_off', L, [
        P('root', liftT, liftP),
        Q('root', liftT, liftQ),
        ...still(L),
        P('hold_strut', [0, 1, 2, L], [-6, 1.5, 0, -6, 1.5, 0, -6, 2.5, 0, -6, 2.5, 0]),
        Q('hold_strut', [0, L], [...b, ...b]),
        P('hold_door', [0, L], [-9, 2.4, -3.7, -9, 2.4, -3.7]),
        Q('hold_door', [0, 1, L], [...open, ...b, ...b]),
      ]),
      new THREE.AnimationClip('land', D, [
        P('root', landT, landP),
        Q('root', landT, landQ),
        ...still(D),
        P('hold_strut', [0, D - 2, D - 1, D], [-6, 2.5, 0, -6, 2.5, 0, -6, 1.5, 0, -6, 1.5, 0]),
        Q('hold_strut', [0, D], [...b, ...b]),
        P('hold_door', [0, D], [-9, 2.4, -3.7, -9, 2.4, -3.7]),
        Q('hold_door', [0, D - 1, D], [...b, ...b, ...open]),
      ]),
      new THREE.AnimationClip('loop_ground', 1 / 30, [
        P('root', [0, 1 / 30], [...rest.toArray(), ...rest.toArray()]),
        Q('root', [0, 1 / 30], [...r, ...r]),
        ...still(1 / 30),
        P('hold_strut', [0, 1 / 30], [-6, 1.5, 0, -6, 1.5, 0]),
        Q('hold_strut', [0, 1 / 30], [...b, ...b]),
        P('hold_door', [0, 1 / 30], [-9, 2.4, -3.7, -9, 2.4, -3.7]),
        Q('hold_door', [0, 1 / 30], [...open, ...open]),
      ]),
      new THREE.AnimationClip('loop_sky', 1 / 30, [
        P('root', [0, 1 / 30], [...rest.toArray(), ...rest.toArray()]),
        Q('root', [0, 1 / 30], [...r, ...r]),
        ...still(1 / 30),
        P('hold_strut', [0, 1 / 30], [-6, 2.5, 0, -6, 2.5, 0]),
        Q('hold_strut', [0, 1 / 30], [...b, ...b]),
        P('hold_door', [0, 1 / 30], [-9, 2.4, -3.7, -9, 2.4, -3.7]),
        Q('hold_door', [0, 1 / 30], [...b, ...b]),
      ]),
    ],
  };
  const clips: RigClips = { land: 'land', lift: 'take_off', ground: 'loop_ground', sky: 'loop_sky' };
  const block: TravelRig = {
    ...madeUpRigBlock,
    file: 'travel/rig_flying.glb',
    moods: { '': clips },
    seconds: { land: D, take_off: L, loop_ground: 1 / 30, loop_sky: 1 / 30 },
  };
  return { skeleton, pieces: madeUpPieces(), block, clips };
}

/** A GLB's nodes as three objects (joints as bones), its meshes' positions and indices, and its clips as the loader makes them. */
export function loadGlb(file: string): Skeleton {
  const { json, bin } = readGlb(readFileSync(file)) as { json: GltfJson; bin: Buffer };
  const read = (i: number): Float32Array | Uint32Array => {
    const a = json.accessors[i];
    const view = json.bufferViews[a.bufferView];
    const n = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const count = a.count * n;
    if (a.componentType === 5126) {
      const out = new Float32Array(count);
      for (let k = 0; k < count; k++) out[k] = bin.readFloatLE(base + k * 4);
      return out;
    }
    const out = new Uint32Array(count);
    const size = a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    for (let k = 0; k < count; k++) out[k] = size === 4 ? bin.readUInt32LE(base + k * 4) : size === 2 ? bin.readUInt16LE(base + k * 2) : bin.readUInt8(base + k);
    return out;
  };
  const joints = new Set<number>((json.skins ?? []).flatMap((s) => s.joints));
  const nodes = json.nodes.map((n, i) => {
    let o: THREE.Object3D;
    if (n.mesh !== undefined) {
      const group = new THREE.Group();
      for (const prim of json.meshes![n.mesh].primitives) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(read(prim.attributes.POSITION) as Float32Array, 3));
        if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(read(prim.indices), 1));
        group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
      }
      o = group;
    } else o = joints.has(i) ? new THREE.Bone() : new THREE.Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => nodes[i].add(nodes[c])));
  const scene = new THREE.Group();
  for (const i of json.scenes[0].nodes) scene.add(nodes[i]);
  const animations = (json.animations ?? []).map((an) => {
    const tracks = an.channels.map((c) => {
      const s = an.samplers[c.sampler];
      const times = read(s.input) as Float32Array;
      const values = read(s.output) as Float32Array;
      const name = `${json.nodes[c.target.node].name}.${c.target.path === 'translation' ? 'position' : c.target.path === 'rotation' ? 'quaternion' : 'scale'}`;
      return c.target.path === 'rotation' ? new THREE.QuaternionKeyframeTrack(name, times, values) : new THREE.VectorKeyframeTrack(name, times, values);
    });
    return new THREE.AnimationClip(an.name, -1, tracks);
  });
  return { scene, animations };
}
interface GltfJson {
  nodes: { name?: string; children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes: { nodes: number[] }[];
  skins?: { joints: number[] }[];
  meshes?: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { byteOffset?: number }[];
  animations?: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
}

/** Every rig any converted world's travel pack carries, by name (a world carries only the rigs its own ports stand). */
export function packRigs(packs: string, list: (dir: string) => string[], exists: (file: string) => boolean, join: (...p: string[]) => string): Record<string, TravelRig> {
  const rigs: Record<string, TravelRig> = {};
  if (!exists(packs)) return rigs;
  for (const w of list(packs).sort()) {
    const file = join(packs, w, 'travel.json');
    if (!exists(file)) continue;
    for (const [name, rig] of Object.entries((JSON.parse(readFileSync(file, 'utf8')) as { rigs?: Record<string, TravelRig> }).rigs ?? {})) rigs[name] ??= rig;
  }
  return rigs;
}
