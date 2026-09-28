// The engine's own step, and the one way it has been seen to throw from inside it
// (src/core/physics.ts, `Physics.keeper`, `Physics.broken`).
//
// The engine is real and so is the sequence. Rapier 0.35 (@dimforge/rapier3d-compat 0.20) keeps, for
// its continuous collision pass, a list of every fixed collider in the world with its box, and throws
// that list away only on a step that both runs the pass (something is moving fast) and carries a user
// change. A collider taken away on a step where nothing was fast is never struck off, and the next
// step on which something fast crosses the box it had -- with nothing written that step -- looks the
// collider up by a handle the world no longer holds: a panic inside `World.step`, after which every
// call into that world fails as "recursive use of an object". In play it was a corpse, or a body far
// off, lying on ground the streamer had just taken away under a player who teleported, starting to
// fall. The browser's stack and this file's are the same six frames of the engine's own.
//
// Four things are pinned. The sequence really does panic a bare world of this engine (so the fix is
// not guarding against nothing). The same sequence through the game's wrapper does not, with a body
// on the ground and with a corpse. A world that breaks anyway is caught at the step, said once, and
// never stepped again, rather than failing every frame. And the engine outlives a broken world: a
// world with an event queue of its own, made before or after, still steps -- which is what says the
// only way back is a world made afresh, and not that the whole engine is lost.
//
// And the rest of the class of panic, which is not the step's at all: a call on a body the world no
// longer holds breaks the world wherever it is made (3b to 3f). The step never throws on such a world
// even with a corpse in it, a fault is told from any other error, which world it was can be asked
// without stepping, a caller that meets one first breaks the world as the step would, and a body is
// never taken out twice. What the game does with all of that is read off main.ts (6), with the death
// that used to outlive the world it happened in (7).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FIXED_DT, Physics, RAPIER, isEngineFault } from '../../../src/core/physics.ts';
import { Ragdoll } from '../../../src/combat/ragdoll.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const GRAVITY = 20;
const engine = JSON.parse(readFileSync(new URL('../../../node_modules/@dimforge/rapier3d-compat/package.json', import.meta.url), 'utf8')).version as string;

/** A heightfield chunk of the game's own shape: `relief` metres of hills, so its box reaches well below where anything rests on it. */
function heights(relief: number): Float32Array {
  const h = new Float32Array(17 * 17);
  for (let i = 0; i < h.length; i++) h[i] = relief * Math.sin(i * 0.7);
  return h;
}

/** A plain body of a prop's size and weight, with no continuous collision of its own: the engine sweeps it all the same once it is fast. */
function lump(world: RAPIER.World, x: number, y: number, z: number): RAPIER.RigidBody {
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.12).setAngularDamping(0.45));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3).setMass(20).setRestitution(0.22).setFriction(0.85), b);
  return b;
}

/** A person-shaped skeleton of round numbers, standing with its feet at `y`. */
function figure(x: number, y: number, z: number): THREE.Object3D {
  const bone = (name: string, bx: number, by: number, bz: number): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(bx, by, bz);
    return b;
  };
  const root = new THREE.Object3D();
  const pelvis = bone('pelvis', 0, 1, 0);
  const spine = bone('spine', 0, 0.25, 0);
  const chest = bone('chest', 0, 0.2, 0);
  const neck = bone('neck', 0, 0.17, 0);
  const head = bone('head', 0, 0.1, 0);
  head.add(bone('crown', 0, 0.23, 0));
  neck.add(head);
  chest.add(neck);
  for (const side of [1, -1]) {
    const upper = bone(`upperarm${side}`, 0.18 * side, 0, 0);
    const fore = bone(`forearm${side}`, 0.27 * side, 0, 0);
    fore.add(bone(`hand${side}`, 0.25 * side, 0, 0));
    upper.add(fore);
    chest.add(upper);
    const thigh = bone(`thigh${side}`, 0.1 * side, -0.05, 0);
    const shin = bone(`shin${side}`, 0, -0.43, 0);
    const foot = bone(`foot${side}`, 0, -0.44, 0);
    foot.add(bone(`toe${side}`, 0, -0.02, 0.12));
    shin.add(foot);
    thigh.add(shin);
    pelvis.add(thigh);
  }
  spine.add(chest);
  pelvis.add(spine);
  root.add(pelvis);
  root.position.set(x, y, z);
  root.updateMatrixWorld(true);
  return root;
}

/**
 * The sequence, on whatever steps it is handed. Two chunks of ground; a lump dropped from high on
 * the first, so that on the steps it falls the continuous pass runs and lists both chunks; a lump
 * resting on the second. Once everything lies still the second chunk is taken away, on a step where
 * nothing is fast, and from then on nothing is written by hand: the lump falls through where the
 * chunk was, and on the first step it is fast the pass sweeps it against the list.
 */
function sequence(world: RAPIER.World, step: () => void, remove: (c: RAPIER.Collider) => void, chunk: (x: number, z: number, relief: number) => RAPIER.Collider): { resting: number; after: number } {
  chunk(-32, -32, 0);
  const under = chunk(200, -32, 30);
  lump(world, 0, 40, 0);
  const q = lump(world, 232, 60, 0);
  for (let i = 0; i < 400; i++) step();
  const resting = q.translation().y;
  remove(under);
  for (let i = 0; i < 200; i++) step();
  return { resting, after: q.translation().y };
}

const physics = await Physics.create();
ok(physics.broken === null && physics.steps === 0, `0: the engine starts (@dimforge/rapier3d-compat ${engine})`);

// --- 1: a bare world of this engine panics on the sequence ------------------------------------------
{
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  // A queue of its own: a world that panics poisons whatever the step had borrowed, the queue with it.
  const events = new RAPIER.EventQueue(false);
  const hooks = { filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE, filterIntersectionPair: () => true };
  let thrown: Error | null = null;
  let fell = 0;
  try {
    const r = sequence(
      world,
      () => world.step(events, hooks),
      (c) => world.removeCollider(c, false),
      (x, z, relief) => world.createCollider(RAPIER.ColliderDesc.heightfield(16, 16, heights(relief), { x: 64, y: 1, z: 64 }).setTranslation(x + 32, 0, z + 32)),
    );
    fell = r.resting - r.after;
  } catch (e) {
    thrown = e as Error;
  }
  if (thrown) {
    ok(/unreachable/.test(thrown.message), `1: a bare world of this engine panics inside its own step on it ("${thrown.message}") -- the bug the keeper is there for`);
    let after = '';
    try {
      world.step(events, hooks);
    } catch (e) {
      after = (e as Error).message;
    }
    ok(/recursive use of an object/.test(after), '1: and every step after it fails as the browser saw, "recursive use of an object"');
    // The list is kept only while the world holds 512 fixed colliders or fewer; past that the pass
    // uses the broad phase's own tree, which is always current. That is why this struck in open
    // country and never in a town: the same sequence with 513 steps clean on a bare world.
    const crowded = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    crowded.timestep = FIXED_DT;
    const q = new RAPIER.EventQueue(false);
    for (let i = 0; i < 511; i++) crowded.createCollider(RAPIER.ColliderDesc.cylinder(1, 0.3).setTranslation(-500 - (i % 50) * 3, 1, Math.floor(i / 50) * 3));
    let crowdedThrew = false;
    try {
      sequence(
        crowded,
        () => crowded.step(q, hooks),
        (c) => crowded.removeCollider(c, false),
        (x, z, relief) => crowded.createCollider(RAPIER.ColliderDesc.heightfield(16, 16, heights(relief), { x: 64, y: 1, z: 64 }).setTranslation(x + 32, 0, z + 32)),
      );
    } catch {
      crowdedThrew = true;
    }
    ok(!crowdedThrew, '1: and it needs 512 fixed colliders or fewer: with 513 in the world the same sequence steps clean, which is why a town never showed it');
  } else {
    // An engine that no longer has the bug (rapier 0.36, rapier3d-compat 0.21 and on) walks straight
    // through it. Said rather than failed: the keeper is then one wasted call a step, and can go.
    console.log(`note 1: @dimforge/rapier3d-compat ${engine} no longer panics on the sequence (the body fell ${fell.toFixed(1)} m); the keeper in src/core/physics.ts is no longer needed`);
  }
}

// --- 2: through the game's wrapper it does not ---------------------------------------------------
{
  const w = Physics.local(GRAVITY);
  const r = sequence(
    w.world,
    () => w.step(FIXED_DT),
    (c) => w.removeCollider(c),
    (x, z, relief) => w.createHeightfield(x, z, 64, 16, heights(relief)),
  );
  ok(w.broken === null, '2: the same sequence through the wrapper steps clean to the end');
  ok(r.resting - r.after > 20, `2: and the body really did go through where its ground was (${(r.resting - r.after).toFixed(1)} m down), so the sweep was reached`);
}
{
  // And the one-off step the game takes to make a query see what it just built (`stepOnce`), which
  // is exactly the kind of step that carries no write of the game's own.
  const w = Physics.local(GRAVITY);
  sequence(
    w.world,
    () => w.stepOnce(),
    (c) => w.removeCollider(c),
    (x, z, relief) => w.createHeightfield(x, z, 64, 16, heights(relief)),
  );
  ok(w.broken === null, '2: and so does every step of it taken one at a time through `stepOnce`');
}
{
  // What the browser really had under it: a corpse lying on a chunk of ground the streamer took away.
  const w = Physics.local(GRAVITY);
  w.createHeightfield(-32, -32, 64, 16, heights(0));
  const under = w.createHeightfield(200, -32, 64, 16, heights(30));
  // Something fast first, as a fall off a ledge is, so the pass lists both chunks.
  lump(w.world, 0, 40, 0);
  const rd = new Ragdoll(w, figure(232, 45, 0));
  for (let i = 0; i < 480; i++) {
    w.step(FIXED_DT);
    rd.update(FIXED_DT);
  }
  const lay = rd.centre(new THREE.Vector3()).y;
  w.removeCollider(under);
  for (let i = 0; i < 240; i++) {
    w.step(FIXED_DT);
    rd.update(FIXED_DT);
  }
  const now = rd.centre(new THREE.Vector3()).y;
  ok(w.broken === null, `2: a corpse whose ground is taken from under it falls through where it was (${(lay - now).toFixed(1)} m) and the world steps on`);
  rd.dispose();
}

// --- 3: a world that breaks anyway is caught at the step, once -----------------------------------
{
  const w = Physics.local(GRAVITY);
  const b = lump(w.world, 0, 2, 0);
  w.step(FIXED_DT);
  const heard: Error[] = [];
  const was = Physics.onBroken;
  Physics.onBroken = (p, err) => {
    if (p === w) heard.push(err);
  };
  const quiet = console.error;
  console.error = () => undefined;
  try {
    // A body taken out twice is a panic outside the step, which leaves the world's sets borrowed:
    // the step after it is the first call to find out.
    w.world.removeRigidBody(b);
    try {
      w.world.removeRigidBody(b);
    } catch {
      /* the panic itself, where it happened */
    }
    let threw = false;
    try {
      w.step(FIXED_DT);
      w.step(FIXED_DT);
      w.stepOnce();
    } catch {
      threw = true;
    }
    ok(!threw, '3: a world broken by anything is caught at the step and does not throw into the frame');
    ok(w.broken !== null && /recursive use of an object/.test(w.broken.message), `3: it keeps what broke it ("${w.broken?.message.slice(0, 40)}")`);
    ok(heard.length === 1, '3: and says so once, however many more times it is asked to step');
  } finally {
    console.error = quiet;
    Physics.onBroken = was;
  }
}

// --- 3b: and so is one broken outside it, with a corpse in the world ---------------------------------
// The commonest panic is not the step's at all but a call on a body the world no longer holds, made
// anywhere in a frame. With a corpse lying in the world the step's first call is not the engine's step
// but the walk over every body the contact filter needs (`refreshMovers`), and on a world whose bodies a
// panic left held for writing that walk is what throws: outside the step's own catch it failed the frame
// every frame and the world was never called broken, so nothing ever started the recovery.
{
  const quiet = console.error;
  console.error = () => undefined;
  const was = Physics.onBroken;
  try {
    for (const how of ['taken out twice', 'written after it was taken out', 'read after it was taken out'] as const) {
      const w = Physics.local(GRAVITY);
      w.createHeightfield(-32, -32, 64, 16, heights(0));
      const b = lump(w.world, 0, 3, 0);
      const rd = new Ragdoll(w, figure(4, 0.2, 0));
      w.step(FIXED_DT);
      const heard: Error[] = [];
      Physics.onBroken = (p, err) => {
        if (p === w) heard.push(err);
      };
      w.world.removeRigidBody(b);
      try {
        if (how === 'taken out twice') w.world.removeRigidBody(b);
        else if (how === 'written after it was taken out') b.setLinvel({ x: 0, y: 1, z: 0 }, true);
        else b.translation();
      } catch {
        /* the panic itself, where it happened */
      }
      let threw = '';
      for (const go of [() => w.step(FIXED_DT * 3), () => w.stepOnce(), () => w.step(FIXED_DT)]) {
        try {
          go();
        } catch (e) {
          threw = (e as Error).message;
        }
      }
      ok(threw === '' && w.broken !== null && heard.length === 1, `3b: a body ${how}, a corpse lying in the world: the step and the one-off step never throw, the world is called broken and it is said once (${threw || (w.broken?.message ?? '').slice(0, 30)})`);
      void rd;
    }
  } finally {
    console.error = quiet;
    Physics.onBroken = was;
  }
}

// --- 3c: what is the engine's, and what is not -----------------------------------------------------
// The frame loop's catch starts the recovery on a fault of the engine's wherever in a frame it is met,
// which is only right if it can tell one from any other failure: taken for the engine's, an ordinary bug
// would reload the page; missed, a broken world fails every frame until the tab is closed.
{
  const w = Physics.local(GRAVITY);
  const b = lump(w.world, 0, 3, 0);
  w.step(FIXED_DT);
  w.world.removeRigidBody(b);
  let panic: unknown = null;
  try {
    b.translation();
  } catch (e) {
    panic = e;
  }
  let after: unknown = null;
  try {
    b.setTranslation({ x: 0, y: 0, z: 0 }, true);
    w.world.forEachRigidBody(() => undefined);
    w.world.step();
  } catch (e) {
    after = e;
  }
  ok(isEngineFault(panic), `3c: the panic itself is the engine's (${String((panic as Error)?.message)})`);
  ok(isEngineFault(after), `3c: and so is every call into that world after it (${String((after as Error)?.message).slice(0, 40)})`);
  ok(!isEngineFault(new Error('the frame is broken on purpose')) && !isEngineFault(new TypeError("Cannot read properties of undefined (reading 'x')")) && !isEngineFault(null) && !isEngineFault('unreachable'), '3c: an ordinary error, a type error, nothing and a word are not');
  ok(isEngineFault('recursive use of an object detected which would lead to unsafe aliasing in rust'), '3c: the engine\'s own words are, however they were thrown');
}

// --- 3d: which world went bad, asked without stepping it -----------------------------------------------
// A frame that fails on a fault of the engine's does not say which world it was calling into: the room
// the player stands in has a world of its own. `answers` tells them apart as far as it can without
// stepping, and the step itself catches what it cannot see.
{
  const quiet = console.error;
  console.error = () => undefined;
  try {
    const healthy = Physics.local(GRAVITY);
    lump(healthy.world, 0, 3, 0);
    healthy.step(FIXED_DT);
    ok(healthy.answers() && healthy.broken === null, '3d: a sound world answers, and asking breaks nothing');
    const steps = healthy.steps;
    healthy.step(FIXED_DT);
    ok(healthy.steps === steps + 1 && healthy.broken === null, '3d: and it steps on after being asked');
    const cases: [string, (w: Physics, b: RAPIER.RigidBody, c: RAPIER.Collider) => void][] = [
      ['a body read after it was taken out', (w, b) => (w.world.removeRigidBody(b), b.translation())],
      ['a body written after it was taken out', (w, b) => (w.world.removeRigidBody(b), b.setLinvel({ x: 0, y: 1, z: 0 }, true))],
      ['a body taken out twice', (w, b) => (w.world.removeRigidBody(b), w.world.removeRigidBody(b))],
      ['a collider written after it was taken out', (w, _b, c) => (w.world.removeCollider(c, false), c.setCollisionGroups(0xffffffff))],
    ];
    for (const [what, poison] of cases) {
      const w = Physics.local(GRAVITY);
      const b = lump(w.world, 0, 3, 0);
      const ground = w.createHeightfield(-32, -32, 64, 16, heights(0));
      w.step(FIXED_DT);
      try {
        poison(w, b, ground);
      } catch {
        /* the panic */
      }
      ok(!w.answers() && w.broken === null, `3d: ${what}: the world does not answer (and asking is not what calls it broken)`);
    }
    // The one it cannot see: a collider read after it was taken out leaves the colliders held for reading
    // only, which a count goes straight through. The next step is the first to find out, and says so.
    const w = Physics.local(GRAVITY);
    const ground = w.createHeightfield(-32, -32, 64, 16, heights(0));
    lump(w.world, 0, 3, 0);
    w.step(FIXED_DT);
    w.world.removeCollider(ground, false);
    try {
      ground.translation();
    } catch {
      /* the panic */
    }
    const blind = w.answers();
    w.step(FIXED_DT);
    ok(w.broken !== null && !w.answers(), `3d: a collider read after it was taken out ${blind ? 'is not seen by the question' : 'is seen'}, and the next step calls the world broken`);
  } finally {
    console.error = quiet;
  }
}

// --- 3e: broken from outside, once -------------------------------------------------------------------
{
  const w = Physics.local(GRAVITY);
  lump(w.world, 0, 3, 0);
  w.step(FIXED_DT);
  const heard: Error[] = [];
  const was = Physics.onBroken;
  const quiet = console.error;
  const logged: unknown[] = [];
  console.error = (...a: unknown[]) => void logged.push(a);
  Physics.onBroken = (p, err) => {
    if (p === w) heard.push(err);
  };
  try {
    const fault = new Error('recursive use of an object detected which would lead to unsafe aliasing in rust');
    w.fail(fault);
    w.fail(new Error('a second fault'));
    const steps = w.steps;
    w.step(FIXED_DT * 4);
    w.stepOnce();
    ok(w.broken === fault && heard.length === 1 && heard[0] === fault && logged.length === 1, '3e: a fault met by a caller breaks the world as a panic in the step does: kept, logged once, told once, and a second one changes nothing');
    ok(w.steps === steps, '3e: and a world broken that way is never stepped again');
    // A recovery that throws is its own failure, not the world's second one, and goes no further.
    const x = Physics.local(GRAVITY);
    Physics.onBroken = () => {
      throw new Error('the recovery itself failed');
    };
    let threw = false;
    try {
      x.fail(new Error('unreachable'));
    } catch {
      threw = true;
    }
    ok(!threw && x.broken !== null, '3e: a recovery that throws is caught where it is told, and the world is still called broken');
  } finally {
    console.error = quiet;
    Physics.onBroken = was;
  }
}

// --- 3f: a body is taken out once --------------------------------------------------------------------
// Removing a body the world no longer holds is itself a panic (the engine asks the body for its colliders
// first), which is why a dispose that catches one only hides where the world broke. `removeBody` leaves a
// body already gone alone, and asks nothing of a world that has already broken.
{
  const w = Physics.local(GRAVITY);
  w.createHeightfield(-32, -32, 64, 16, heights(0));
  const b = lump(w.world, 0, 3, 0);
  w.step(FIXED_DT);
  const before = w.bodyCount();
  w.removeBody(b);
  w.removeBody(b);
  ok(w.bodyCount() === before - 1 && w.answers(), '3f: a body taken out twice through `removeBody` is taken out once, and the world still answers');
  w.step(FIXED_DT);
  ok(w.broken === null, '3f: and steps on');
  const quiet = console.error;
  const was = Physics.onBroken;
  console.error = () => undefined;
  Physics.onBroken = null;
  try {
    const gone = Physics.local(GRAVITY);
    const c = lump(gone.world, 0, 3, 0);
    gone.fail(new Error('unreachable'));
    let threw = false;
    try {
      gone.removeBody(c);
    } catch {
      threw = true;
    }
    ok(!threw, '3f: a world already broken is asked nothing at all');
  } finally {
    console.error = quiet;
    Physics.onBroken = was;
  }
  // The places that had a catch round a removal and swallowed whatever it threw: the nests' and the camps'
  // go through `removeBody` now, and a hull's too, which the remote rooms' two catches then report as the
  // world's when it is the engine's rather than hide.
  const nest = readFileSync(new URL('../../../src/world/wildNest.ts', import.meta.url), 'utf8');
  ok(!/removeRigidBody/.test(nest) && (nest.match(/physics\.removeBody\(this\.body\)/g) ?? []).length === 2, '3f: the nest and the camp take their bodies out through it, with no catch round the removal');
  const vehicle = readFileSync(new URL('../../../src/vehicles/vehicle.ts', import.meta.url), 'utf8');
  const disposeHull = /\n  dispose\(physics: Physics, scene: THREE\.Scene\): void \{[\s\S]*?\n  \}/.exec(vehicle)?.[0] ?? '';
  ok(/physics\.removeBody\(this\.body\)/.test(disposeHull) && !/removeRigidBody/.test(disposeHull), '3f: so does a hull, so a second dispose of one is harmless');
  const rooms = readFileSync(new URL('../../../src/net/remoteInterior.ts', import.meta.url), 'utf8');
  ok((rooms.match(/if \(isEngineFault\((e|err)\)\) deps\.physics\.fail\(\1\);/g) ?? []).length === 2, "3f: and the remote rooms' two catches round a hull's dispose hand an engine fault to the world rather than swallow it");
}

// --- 4: the engine outlives a broken world -------------------------------------------------------
{
  // Worlds 1 and 3 above are broken for good. A world made before them and one made now both step and
  // answer a ray: a panic poisons the world (and the event queue) the step had borrowed, not the engine.
  const w = Physics.local(GRAVITY);
  w.createHeightfield(-32, -32, 64, 16, heights(0));
  const b = lump(w.world, 0, 3, 0);
  for (let i = 0; i < 90; i++) w.step(FIXED_DT);
  ok(w.broken === null && Math.abs(b.translation().y - 0.3) < 0.1, `4: a world made after a panic steps (the lump rests at ${b.translation().y.toFixed(2)})`);
  ok(w.groundDistance(5, 10, 5, 50) !== null, '4: and answers a ray');
  physics.stepOnce();
  ok(physics.broken === null, '4: and the world made before any of it still steps');
}

// --- 5: the keeper is nobody else's --------------------------------------------------------------
{
  const w = Physics.local(GRAVITY);
  ok(w.bodyCount() === 0, '5: a new world holds no body anybody put in it (the keeper is not counted)');
  const b = lump(w.world, 0, 3, 0);
  ok(w.bodyCount() === 1 && !w.isKeeper(b), '5: one put in is one counted, and it is not the keeper');
  let keepers = 0;
  w.world.forEachRigidBody((x) => {
    if (w.isKeeper(x)) {
      keepers++;
      ok(x.isFixed() && x.numColliders() === 0, '5: the keeper is fixed and has no collider, so no query, contact or island ever meets it');
    }
  });
  ok(keepers === 1, '5: and there is exactly one of it');
  const source = readFileSync(new URL('../../../src/core/physics.ts', import.meta.url), 'utf8');
  const one = /private stepWorld\(\): boolean \{[\s\S]*?\n  \}/.exec(source)?.[0] ?? '';
  ok(one.indexOf('this.keeper.') >= 0 && one.indexOf('this.keeper.') < one.indexOf('this.world.step('), '5: and it is written before the engine is stepped, on every step');
  // The two rooms that stepped their own world raw now go through it too.
  for (const file of ['../../../src/vehicles/interior.ts', '../../../src/vehicles/surfaceRoom.ts']) {
    ok(!/\.world\.step\(/.test(readFileSync(new URL(file, import.meta.url), 'utf8')), `5: ${file.replace('../../../', '')} steps its room through the wrapper, never the raw call`);
  }
}

// --- 6: what the game does with it -----------------------------------------------------------------
// main.ts is the one file a node test cannot run, so the three things it must do are read off it. A
// fault of the engine's met anywhere in a frame starts the recovery (a world broken outside the step
// used to fail every frame at its first call into the world, long before the step's catch, with nothing
// said and nothing reloaded). Once broken, the frame stops before anything calls into a world (the frame
// used to go on failing at the player's own update every frame, with the rest of it skipped). And the
// recovery stops the sound and, when it does not reload, gives the pointer back.
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const run = /\n  run\(\): void \{[\s\S]*?\n  \}\n/.exec(main)?.[0] ?? '';
  const caught = /\} catch \(err\) \{[\s\S]*?console\.error\('frame failed/.exec(run)?.[0] ?? '';
  ok(/if \(isEngineFault\(err\)\) this\.engineFault\(err\);/.test(caught), '6: a frame that fails on a fault of the engine\'s starts the recovery, wherever in the frame it was met');
  const stop = run.indexOf('if (this.physicsFailed) {');
  const firstWorldCall = Math.min(...['this.savePlace()', 'player.update(', 'this.physics.step(', 'this.world.update(', 'this.stepVehicles('].map((s) => run.indexOf(s)).filter((i) => i >= 0));
  ok(stop > run.indexOf('if (!this.inWorld)') && stop < firstWorldCall, '6: and once a world has broken the frame stops before anything in it calls into a world');
  const fault = /private engineFault\(err: unknown\): void \{[\s\S]*?\n  \}/.exec(main)?.[0] ?? '';
  ok(/\.answers\(\)/.test(fault) && /at\.fail\(err\)/.test(fault), '6: which world it was is asked of the world and the room the player stands in, and that one is called broken');
  const broke = /private physicsBroke\(p: Physics, err: Error\): void \{[\s\S]*?\n  \}/.exec(main)?.[0] ?? '';
  const stoppedBranch = /if \(!PHYSICS_RECOVERY\.reload[\s\S]*?return;\n    \}/.exec(broke)?.[0] ?? '';
  ok(broke.indexOf('this.physicsFailed = true;') >= 0 && broke.indexOf('this.audio.stopAll()') > broke.indexOf('this.physicsFailed = true;'), '6: the recovery stops the frames and the sound with them');
  ok(/this\.freeMouse\(true\);/.test(stoppedBranch), '6: and when it is not reloading, gives the pointer back');
}

// --- 7: a death does not outlive the world it happened in --------------------------------------------
// Found while breaking worlds on purpose, and not a panic but its neighbour: dying, then going to the
// select screen and playing again, arrived dead under the card with the last body's pieces falling
// through the ground that had gone from under them (from y -4345 to -8458 within seconds, the camera
// following), because nothing on the road to the select screen ended the death. Aboard, those pieces are
// in a room's own world, which goes with its hull, so the next arrival would have read a freed world.
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const end = /private endDeath\(\): void \{[\s\S]*?\n  \}/.exec(main)?.[0] ?? '';
  ok(['this.player.endRagdoll();', 'this.dying = false;', "this.death.classList.remove('on');", 'this.deathChoices = [];', 'this.rideRescue = null;'].every((s) => end.includes(s)), '7: putting a death away ends the corpse, the dying, the card, its choices and a rescue waiting on the respawn');
  const leave = /private switchToSelect\(\): void \{[\s\S]*?\n  \}/.exec(main)?.[0] ?? '';
  const at = leave.indexOf('this.endDeath();');
  ok(at >= 0 && at < leave.indexOf('this.leaveShip(') && at < leave.indexOf('this.world.leave()'), '7: and going to the select screen puts it away, before the ship is left and before the world goes');
  const fade = /private async fadeAndRespawn\(\): Promise<void> \{[\s\S]*?\n  \}/.exec(main)?.[0] ?? '';
  ok(fade.indexOf('if (!this.dying) return;') >= 0 && fade.indexOf('if (!this.dying) return;') < fade.indexOf('this.respawn()'), '7: and a respawn already under way for a body with no rig does not come round on the select screen');
}

console.log(`\n${checks} checks passed`);
