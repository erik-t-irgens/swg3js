// The shuttles drawn on their rigs (src/world/shuttleRigs.ts), driven in node against a real physics
// world with a rig made up here: two joints, a hull on one and a door on the other, and the four clips a
// shuttle's round is made of. Nothing of the game's data is read, so it runs on any machine; what is
// checked is the runtime's own half -- the pieces hung on the right joints, the pose put where the
// round says, the parked hull solid and the flying one not, and everything taken down when the world
// goes, including a stand still loading when it went.
//
// Run: node tools/swg/tests/shuttleRigs.test.ts

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics, RAPIER } from '../../../src/core/physics.ts';
import { SHUTTLE_RIG_TUNE, ShuttleRigs } from '../../../src/world/shuttleRigs.ts';
import type { ShuttleState, TravelRig } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

// ---------------------------------------------------------------- a rig made up here

function makeRig(): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
  const scene = new THREE.Group();
  const root = new THREE.Bone();
  root.name = 'root';
  const arm = new THREE.Bone();
  arm.name = 'arm';
  arm.position.set(0, 0, 5);
  root.add(arm);
  scene.add(root);
  const track = (times: number[], values: number[]) => new THREE.VectorKeyframeTrack('root.position', times, values);
  return {
    scene,
    animations: [
      new THREE.AnimationClip('land', 10, [track([0, 10], [0, 100, 500, 0, 0, 0])]),
      new THREE.AnimationClip('take_off', 5, [track([0, 5], [0, 0, 0, 0, 50, 300])]),
      new THREE.AnimationClip('loop_ground', 1 / 30, [track([0, 1 / 30], [0, 0, 0, 0, 0, 0])]),
      new THREE.AnimationClip('loop_sky', 1 / 30, [track([0, 1 / 30], [0, 100, 500, 0, 100, 500])]),
    ],
  };
}
const box = (w: number, h: number, d: number, name: string) => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
  m.name = name;
  m.position.y = h / 2;
  g.add(m);
  return g;
};

const rig: TravelRig = {
  file: 'travel/rig.glb',
  parts: [
    { joint: 'root', file: 'travel/hull.glb' },
    { joint: 'arm', file: 'travel/door.glb' },
  ],
  moods: { '': { land: 'land', lift: 'take_off', ground: 'loop_ground', sky: 'loop_sky' } },
  seconds: { land: 10, take_off: 5 },
};

const physics = await Physics.create();
const scene = new THREE.Scene();
let prepared = 0;
const forgotten: THREE.Material[] = [];
const rigs = new ShuttleRigs({
  scene,
  physics,
  base: '',
  prepare: async () => {
    prepared++;
  },
  forget: (m) => forgotten.push(...m),
});
// The network stood in for: the rig and its pieces handed over as a loader would.
let loads = 0;
(rigs as unknown as { loader: { loadAsync(url: string): Promise<unknown> } }).loader = {
  loadAsync: async (url: string) => {
    loads++;
    if (url.endsWith('rig.glb')) return makeRig();
    return { scene: url.endsWith('hull.glb') ? box(4, 2, 10, 'hull') : box(0.2, 2, 1, 'door'), animations: [] };
  },
};

let state: ShuttleState = { phase: 'away', until: 10, left: 0, glide: 0 };
const clock = { times: { land: 10, lift: 5 }, state: () => state };
const pad = { x: 100, y: 20, z: -30, yaw: 0 };
const camera = new THREE.Vector3(100, 22, -10);
const joint = (name: string) => scene.getObjectByName(name)!;
const worldY = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
};

// ---------------------------------------------------------------- standing one

{
  ok(await rigs.stand('a', rig, '', pad, false, clock), 'a shuttle stands on its rig');
  ok(prepared === 1, 'prepared once, before it is ever shown');
  const shuttle = scene.getObjectByName('shuttle:a')!;
  ok(!!shuttle && shuttle.position.equals(new THREE.Vector3(100, 20, -30)) && !shuttle.visible, 'on its pad and not shown until its round says so');
  ok(!!joint('hull') && joint('hull').parent?.parent?.name === 'root' && joint('door').parent?.parent?.name === 'arm', 'each piece hangs on the joint its client data names');
}

// ---------------------------------------------------------------- posed by its round

{
  rigs.update(camera);
  ok(!scene.getObjectByName('shuttle:a')!.visible, 'away, it is not drawn');
  state = { phase: 'landing', until: 5, left: 0, glide: 0.5 };
  rigs.update(camera);
  const at = worldY(joint('root'));
  ok(scene.getObjectByName('shuttle:a')!.visible && near(at.y, 70) && near(at.z, 220), `half way down it is half way along its landing (${at.toArray().map((n) => n.toFixed(1)).join(', ')})`);
  ok(!rigs.describe().shuttles[0].solid, 'and a hull in flight is not solid');
  const moved = [] as THREE.Object3D[];
  ok(rigs.roots(moved).length === 1 && moved[0].name === 'shuttle:a', 'and the motion blur is told it moves');
}

{
  state = { phase: 'waiting', until: 0, left: 30, glide: 1 };
  rigs.update(camera);
  ok(near(worldY(joint('root')).y, 20), 'waiting, it stands on its pad');
  ok(rigs.describe().shuttles[0].solid, 'and is solid');
  physics.stepOnce();
  const hit = physics.world.castRay(new RAPIER.Ray({ x: 100, y: 40, z: -30 }, { x: 0, y: -1, z: 0 }), 50, true);
  ok(!!hit && near(40 - hit.timeOfImpact, 22, 0.01), `a ray down onto it meets the hull's top, not the pad (${hit ? (40 - hit.timeOfImpact).toFixed(2) : 'nothing'} m)`);
  const doorHit = physics.world.castRay(new RAPIER.Ray({ x: 100, y: 40, z: -25 }, { x: 0, y: -1, z: 0 }), 50, true);
  ok(!!doorHit, 'the pieces on the other joints are in it too');
}

{
  state = { phase: 'leaving', until: 200, left: 0, glide: 0.2 };
  rigs.update(camera);
  const at = worldY(joint('root'));
  ok(near(at.y, 60) && near(at.z, 210), `leaving, it is most of the way along its lift-off (${at.toArray().map((n) => n.toFixed(1)).join(', ')})`);
  ok(!rigs.describe().shuttles[0].solid, 'and is solid no longer');
  physics.stepOnce();
  ok(!physics.world.castRay(new RAPIER.Ray({ x: 100, y: 40, z: -30 }, { x: 0, y: -1, z: 0 }), 19, true), 'nothing is left standing on the pad');
}

{
  state = { phase: 'waiting', until: 0, left: 30, glide: 1 };
  rigs.update(new THREE.Vector3(100, 20, -30 + SHUTTLE_RIG_TUNE.reach + 10));
  ok(!scene.getObjectByName('shuttle:a')!.visible && !rigs.describe().shuttles[0].solid, 'past its reach from the camera it is neither drawn nor solid');
  SHUTTLE_RIG_TUNE.solid = false;
  rigs.update(camera);
  ok(scene.getObjectByName('shuttle:a')!.visible && !rigs.describe().shuttles[0].solid, 'and with the switch off a parked one is drawn and not solid');
  SHUTTLE_RIG_TUNE.solid = true;
  rigs.update(camera);
}

// ---------------------------------------------------------------- a rig with no lift-off

{
  const broken: TravelRig = { ...rig, moods: { '': { land: 'land', lift: 'nothing' } } };
  const before = scene.children.length;
  ok(!(await rigs.stand('b', broken, '', pad, false, clock)) && scene.children.length === before, 'a rig with no lift-off clip is refused and leaves nothing behind');
}

// ---------------------------------------------------------------- the world goes

{
  // One begun and not finished when the world goes is dropped, not stood in the next world.
  const late = rigs.stand('c', rig, '', pad, false, clock);
  rigs.clear();
  ok(!(await late), 'a stand still loading when the world went is dropped');
  ok(!scene.children.some((c) => c.name.startsWith('shuttle:')), 'and nothing of any shuttle is left in the scene');
  physics.stepOnce();
  ok(!physics.world.castRay(new RAPIER.Ray({ x: 100, y: 40, z: -30 }, { x: 0, y: -1, z: 0 }), 50, true), 'nor in the physics, which outlives every world');
  await new Promise((r) => setTimeout(r, 0));
  ok(forgotten.length > 0, "and the rigs' materials are forgotten before they are disposed");
  ok(rigs.describe().stood === 0, 'nothing is left stood');
  const again = await rigs.stand('d', rig, '', pad, false, clock);
  ok(again && loads > 3, 'and the next world loads its rig again rather than using what was disposed');
}

console.log(`\nshuttle rigs: ${passed} checks passed`);
