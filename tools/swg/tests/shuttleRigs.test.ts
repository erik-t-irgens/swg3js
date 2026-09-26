// The shuttles drawn on their rigs (src/world/shuttleRigs.ts), driven in node against a real physics
// world with a rig made up here: two joints, a hull on one and a door on the other, and the four clips a
// shuttle's round is made of. Nothing of the game's data is read, so it runs on any machine; what is
// checked is the runtime's own half -- the pieces hung on the right joints, the pose put where the
// round says, the parked hull solid and the flying one not, the sounds, flames and shake its clips
// mark, and everything taken down when the world goes, including a stand still loading when it went.
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
const cameraAt = (x: number, y: number, z: number) => {
  const c = new THREE.PerspectiveCamera();
  c.position.set(x, y, z);
  return c;
};
const camera = cameraAt(100, 22, -10);
const DT = 1 / 60;
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
  rigs.update(DT, camera);
  ok(!scene.getObjectByName('shuttle:a')!.visible, 'away, it is not drawn');
  state = { phase: 'landing', until: 5, left: 0, glide: 0.5 };
  rigs.update(DT, camera);
  const at = worldY(joint('root'));
  ok(scene.getObjectByName('shuttle:a')!.visible && near(at.y, 70) && near(at.z, 220), `half way down it is half way along its landing (${at.toArray().map((n) => n.toFixed(1)).join(', ')})`);
  ok(!rigs.describe().shuttles[0].solid, 'and a hull in flight is not solid');
  const moved = [] as THREE.Object3D[];
  ok(rigs.roots(moved).length === 1 && moved[0].name === 'shuttle:a', 'and the motion blur is told it moves');
}

{
  state = { phase: 'waiting', until: 0, left: 30, glide: 1 };
  rigs.update(DT, camera);
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
  rigs.update(DT, camera);
  const at = worldY(joint('root'));
  ok(near(at.y, 60) && near(at.z, 210), `leaving, it is most of the way along its lift-off (${at.toArray().map((n) => n.toFixed(1)).join(', ')})`);
  ok(!rigs.describe().shuttles[0].solid, 'and is solid no longer');
  physics.stepOnce();
  ok(!physics.world.castRay(new RAPIER.Ray({ x: 100, y: 40, z: -30 }, { x: 0, y: -1, z: 0 }), 19, true), 'nothing is left standing on the pad');
}

{
  state = { phase: 'waiting', until: 0, left: 30, glide: 1 };
  rigs.update(DT, cameraAt(100, 20, -30 + SHUTTLE_RIG_TUNE.reach + 10));
  ok(!scene.getObjectByName('shuttle:a')!.visible && !rigs.describe().shuttles[0].solid, 'past its reach from the camera it is neither drawn nor solid');
  SHUTTLE_RIG_TUNE.solid = false;
  rigs.update(DT, camera);
  ok(scene.getObjectByName('shuttle:a')!.visible && !rigs.describe().shuttles[0].solid, 'and with the switch off a parked one is drawn and not solid');
  SHUTTLE_RIG_TUNE.solid = true;
  rigs.update(DT, camera);
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

// ---------------------------------------------------------------- what it sounds and shows
//
// The same made-up rig with what a pack from 4 on carries: an idle loop, three events and the marks
// that say when each happens. The particle effects and the mixer are stood in for by records of what
// was asked of them, which is all the runtime's half is: when a sound starts, when a flame is lit and
// put out, where each is, which room it is heard in, and that nothing is left behind when the world
// goes.
//
// The stand-in effects keep the one rule of `ParticleEffects` that decides how long a flame lasts: a
// passing effect whose emitters never run out is ended at two of its particles' lives and a second and
// a half, every particle at once, while a standing one plays until it is told to stop and taken away.
// And the stand-in mixer copies the room it is handed as the real one does, so a record the shuttle
// writes in place later cannot rewrite what a sound was started with.

{
  /** How long the stand-in's particles live, and where a passing effect of them is ended by `ParticleEffects`. */
  const LIFE = 0.5;
  const PASSING_END = Math.max(LIFE, 0.5) * 2 + 1.5;
  interface StubHandle {
    file: string;
    matrix: THREE.Matrix4;
    contained: boolean;
    transient: boolean;
    frame: null;
    rateScale: number;
    moves: number;
    removed: boolean;
    /** Seconds it has been stepped, and for how many of them it has been put out. */
    age: number;
    outFor: number;
    /** Ended by the effects themselves, as a passing effect is. */
    ended: boolean;
  }
  const handles: StubHandle[] = [];
  const preparedFiles: string[] = [];
  let fxUpdates = 0;
  const fx = {
    prepare: async (file: string) => {
      preparedFiles.push(file);
      return true;
    },
    place: (file: string, matrix: THREE.Matrix4, contained: boolean, transient = false) => {
      const h: StubHandle = { file, matrix: matrix.clone(), contained, transient, frame: null, rateScale: 1, moves: 0, removed: false, age: 0, outFor: 0, ended: false };
      handles.push(h);
      return h as never;
    },
    move: (h: StubHandle, m: THREE.Matrix4) => {
      h.matrix.copy(m);
      h.moves++;
    },
    remove: (h: StubHandle) => {
      h.removed = true;
    },
    particlesOf: (h: StubHandle) => (h.removed || h.ended || h.outFor >= LIFE ? 0 : 6),
    update: (dt: number) => {
      fxUpdates++;
      for (const h of handles) {
        if (h.removed || h.ended) continue;
        h.age += dt;
        if (!(h.rateScale > 0)) h.outFor += dt;
        if (h.transient && (h.age > PASSING_END || h.outFor >= LIFE)) h.ended = true;
      }
    },
  };
  type Space = { building: number; cell: number };
  type Sound = { id: string; key: number; x?: number; y?: number; z?: number; space?: Space };
  const played: Sound[] = [];
  const loops: Sound[] = [];
  const stopped: number[] = [];
  const spaceSets: { key: number; building: number; cell: number }[] = [];
  const preparedSounds = new Set<string>();
  let prepareCalls = 0;
  let moves = 0;
  let nextKey = 1;
  let refuseLoops = false;
  const copy = (s?: Space) => (s ? { building: s.building, cell: s.cell } : undefined);
  const audio = {
    prepare: (ids: Iterable<string>) => {
      prepareCalls++;
      for (const id of ids) preparedSounds.add(id);
    },
    play: (id: string, o: Omit<Sound, 'id' | 'key'> = {}) => {
      played.push({ id, key: nextKey, ...o, space: copy(o.space) });
      return nextKey++;
    },
    loop: (id: string, o: Omit<Sound, 'id' | 'key'> = {}) => {
      loops.push({ id, key: refuseLoops ? 0 : nextKey, ...o, space: copy(o.space) });
      return refuseLoops ? 0 : nextKey++;
    },
    move: () => {
      moves++;
    },
    stop: (key: number) => {
      stopped.push(key);
    },
    setSpace: (key: number, space: Space) => {
      spaceSets.push({ key, building: space.building, cell: space.cell });
    },
  };
  const lastSpace = (key: number) => spaceSets.filter((s) => s.key === key).at(-1);
  // A hangar about the pad, as Theed's is: its doorway faces down the landing's approach, which comes
  // in from 500 m out and 100 m up and crosses into it five seconds before touching down.
  const hangar = (x: number, y: number, z: number) => Math.abs(x - pad.x) < 40 && Math.abs(z - pad.z) < 250 && y < 80;
  let asked = 0;
  const shakes: number[] = [];
  const fxScene = new THREE.Scene();
  const fxRigs = new ShuttleRigs({
    scene: fxScene,
    physics,
    base: '',
    prepare: async () => {},
    forget: () => {},
    fx: fx as never,
    audio,
    spaceAt: (x, y, z) => {
      asked++;
      return hangar(x, y, z) ? { building: 7, cell: 5 } : null;
    },
    shake: (a) => shakes.push(a),
  });
  (fxRigs as unknown as { loader: { loadAsync(url: string): Promise<unknown> } }).loader = {
    loadAsync: async (url: string) => (url.endsWith('rig.glb') ? makeRig() : { scene: url.endsWith('hull.glb') ? box(4, 2, 10, 'hull') : box(0.2, 2, 1, 'door'), animations: [] }),
  };
  const fxRig: TravelRig = {
    ...rig,
    ambient: 'sound/idle.snd',
    events: {
      // Four seconds of flame: longer than the stand-in's passing effect lasts.
      start: { particles: [{ file: 'travel/particles/flame.json', seconds: 4 }] },
      land: { sounds: ['sound/land.snd'], shake: [0.02, 50, 2, 1000] },
      takeoff: { sounds: ['sound/up.snd'], particles: [{ file: 'travel/particles/smoke.json', seconds: 2 }] },
    },
    marks: {
      land: [
        { t: 1.5, joint: 'arm', event: 'start' },
        { t: 6, joint: 'root', event: 'land' },
        { t: 7, joint: 'root', event: 'nothing it answers' },
      ],
      take_off: [{ t: 0, joint: 'root', event: 'takeoff' }],
    },
  };
  let fxState: ShuttleState = { phase: 'away', until: 10, left: 0, glide: 0 };
  const fxClock = { times: { land: 10, lift: 5 }, state: () => fxState };
  const at = (phase: ShuttleState['phase'], glide: number, dt = DT) => {
    fxState = { phase, until: 0, left: 0, glide };
    fxRigs.update(dt, camera);
  };
  /** The landing walked from one second of its clip to another a tenth at a time, the effects stepped the same. */
  const walkLanding = (from: number, to: number) => {
    const n = Math.round((to - from) * 10);
    for (let i = 0; i <= n; i++) at('landing', (from + i / 10) / 10, 0.1);
  };
  const landed = () => played.filter((p) => p.id === 'sound/land.snd').length;

  ok(await fxRigs.stand('fx', fxRig, '', pad, true, fxClock), 'a shuttle with sounds and flames stands');
  // A second one far off, past its reach: it shares the first one's prepared effects and plays nothing.
  ok(await fxRigs.stand('far', fxRig, '', { ...pad, x: pad.x + 20000 }, true, fxClock), 'and a second of the same rig beside it, far off');
  ok(preparedFiles.slice().sort().join() === 'travel/particles/flame.json,travel/particles/smoke.json', `each of its effects is prepared once for the session before it is shown, however many shuttles use it (${preparedFiles.join(', ')})`);
  ok(['sound/idle.snd', 'sound/land.snd', 'sound/up.snd'].every((id) => preparedSounds.has(id)) && preparedSounds.size === 3, `and every sound its client data can play is asked of the bank as it stands, before any mark comes round (${[...preparedSounds].join(', ')})`);

  at('away', 0);
  ok(!loops.length && !played.length && !handles.length, 'away, it makes no sound and lights nothing');
  ok(fxUpdates === 1, 'and the effects it plays in are stepped every frame all the same');

  const callsBefore = prepareCalls;
  at('landing', 0.1);
  ok(loops.length === 1 && loops[0].id === 'sound/idle.snd', 'shown, its idle loop plays');
  ok(prepareCalls === callsBefore + 1, 'and its sounds are asked for again as its landing begins, in case the bank has given them back since');
  ok(loops[0].space?.building === -1, "a hundred metres up and four hundred out, its hum is not yet in the hangar it stands in");
  ok(fxRigs.describe().shuttles[0].room === 'outside', 'which the console says');
  ok(!handles.length && !played.length, 'and before its first mark nothing else happens');

  at('landing', 0.2);
  ok(handles.length === 1 && handles[0].file === 'travel/particles/flame.json' && !handles[0].transient && handles[0].contained, 'inside its window its flame is lit, a standing effect, at the joint it names');
  const arm = fxScene.getObjectByName('arm')!;
  arm.updateWorldMatrix(true, false);
  ok(new THREE.Vector3().setFromMatrixPosition(handles[0].matrix).distanceTo(new THREE.Vector3().setFromMatrixPosition(arm.matrixWorld)) < 1e-6, 'and exactly where that joint is in the world, with no frame of its own');

  walkLanding(2.1, 5.4);
  const flame = handles[0];
  ok(handles.length === 1 && flame.moves > 0 && flame.rateScale === 1, 'later in the window it is the same flame, moved with its joint rather than lit again');
  ok(flame.age > PASSING_END && !flame.ended && !flame.removed && fx.particlesOf(flame as never) > 0, `and still burning ${flame.age.toFixed(1)} s after it was lit, past the ${PASSING_END} s at which the effects would have ended it as a passing effect, every particle at once`);
  ok(fxRigs.describe().shuttles[0].lit === 1 && fxRigs.describe().shuttles[0].idling, 'and the console says one flame is lit and the loop is playing');
  ok(lastSpace(loops[0].key)?.building === 7 && lastSpace(loops[0].key)?.cell === 5, 'flown in through the doorway, its hum is moved into the hangar');
  ok(fxRigs.describe().shuttles[0].room === '7/5', 'which the console says too');
  const asksFlying = asked;

  at('landing', 0.56, 0.1);
  ok(flame.rateScale === 0 && !flame.removed, 'its window closed, the flame is put out: it makes no more and what it made dies away');
  ok(fxRigs.describe().shuttles[0].dying === 1, 'and the console counts it as dying away');
  ok(!played.length, 'and no sound has started, since no sound mark has been crossed');

  at('landing', 0.61, 0.5);
  ok(landed() === 1, 'the landing sound starts on the frame its mark is crossed');
  const land = played.find((p) => p.id === 'sound/land.snd')!;
  ok(land.space?.building === 7 && land.space?.cell === 5, 'in the room the hull is in by then');
  ok(shakes.length > 0 && shakes.every((a) => a > 0 && a <= 1), `and the view shakes, by our scale of the file's amount (${shakes.map((a) => a.toFixed(2)).join(', ')})`);
  ok(!flame.removed, 'the flame put out is not taken away while what it made is still dying');

  at('landing', 0.65, 0.1);
  ok(landed() === 1, 'and never again for the same mark');
  ok(flame.removed && fxRigs.describe().shuttles[0].dying === 0, 'once what it made has died away the flame is taken out of the effects, since a standing effect never ends by itself');
  ok(moves > 0, 'the sounds it started follow their joints');
  ok(!played.some((p) => !/^sound\/(land|up)\.snd$/.test(p.id)), 'a mark whose event nothing answers does nothing');

  at('waiting', 1, 0.5);
  const asksParked = asked;
  at('waiting', 1, 0.5);
  at('waiting', 1, 0.5);
  ok(loops.length === 1 && !stopped.length, 'parked, the idle loop plays on');
  ok(asksParked > asksFlying && asked === asksParked, 'and the room is asked for as a clip begins and while the hull moves, and never while it stands parked');

  at('leaving', 1);
  const up = played.find((p) => p.id === 'sound/up.snd');
  ok(!!up && played.filter((p) => p.id === 'sound/up.snd').length === 1, "the lift-off's mark on its clip's very first instant still starts its sound");
  ok(up?.space?.building === 7, 'in the hangar, where the hull still is');
  const smoke = handles.find((h) => h.file === 'travel/particles/smoke.json');
  ok(!!smoke && smoke.rateScale === 1 && !smoke.transient, 'and lights its smoke');

  at('leaving', 0.5, 0.5);
  ok(!!smoke && smoke.rateScale === 0, 'which is put out when its seconds are up');

  at('leaving', 0.1, 0.5);
  ok(lastSpace(loops[0].key)?.building === -1 && lastSpace(up!.key)?.building === -1, 'flown back out through the doorway, its hum and the lift-off still sounding are heard out in the open');
  ok(!!smoke && smoke.removed, 'and the smoke, died away, is taken out of the effects');

  at('away', 0);
  ok(stopped.includes(loops[0].key), 'gone to the sky, its idle loop stops');

  // Coming into view part way down: every mark it has already passed stays passed.
  const before = played.length;
  at('landing', 0.3);
  ok(played.length === before && loops.length === 2, 'shown again part way through its landing, it idles and sounds nothing it has already passed');
  const lit = handles.filter((h) => !h.removed && h.rateScale > 0);
  ok(lit.length === 1 && lit[0].file === 'travel/particles/flame.json', 'but its flame is lit, because a flame is a state and not an event');
  at('landing', 0.8);
  ok(landed() === 1, 'and a frame that stalls past a mark lets the mark go rather than playing it late');
  at('landing', 0.3);

  fxRigs.clear();
  ok(handles.every((h) => h.removed), `the world going removes every effect it placed, lit or dying away (${handles.length})`);
  ok(stopped.includes(loops[1].key), 'and stops its idle loop');
  ok(played.every((p) => stopped.includes(p.key)), 'and every sound it started');
  const updates = fxUpdates;
  fxRigs.update(DT, camera);
  ok(fxRigs.describe().stood === 0 && fxUpdates === updates + 1, 'after which nothing is stood, while the effects themselves go on being stepped for the session');

  // A mixer that has no such loop says so once a showing, not once a frame.
  refuseLoops = true;
  ok(await fxRigs.stand('quiet', fxRig, '', pad, false, fxClock), 'stood again in the next world');
  const loopsAsked = loops.length;
  const roomAsks = asked;
  at('landing', 0.1);
  at('landing', 0.12);
  at('landing', 0.14);
  ok(loops.length === loopsAsked + 1 && !fxRigs.describe().shuttles[0].idling, 'an idle loop the mixer will not play is asked for once while it is shown, not on every frame');
  at('away', 0);
  at('landing', 0.1);
  ok(loops.length === loopsAsked + 2, 'and once more the next time it is shown');
  ok(loops[loops.length - 1].space === undefined && asked === roomAsks && fxRigs.describe().shuttles[0].room === null, 'and one standing out in the open is given no room to play in, and never asks for one');
  fxRigs.clear();
}

console.log(`\nshuttle rigs: ${passed} checks passed`);
