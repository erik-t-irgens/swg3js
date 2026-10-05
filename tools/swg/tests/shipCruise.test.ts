// A ship in flight whose own numbers lower its top speed, driven for real (src/vehicles/vehicle.ts,
// `flyShip`): a nebula's hold on the engines, or a part knocked down, writes the spec again in one
// step, and the cruise must come down to the new top at the brake whether the pilot holds W or not.
//
// Before, holding W cut the cruise to the new top in a single step (ninety metres a second off a
// fighter in space as it crossed a nebula's edge), and letting go of W kept the old speed for good,
// inside a nebula whose whole point is that the ship is slower in it. A boost's coast, which is above
// the old top, is left exactly as it always was, and so is everything when nothing is lowered. And a
// winged fighter whose NPC pilot opens its wings to fight pays the chassis's share of its top while
// they are open and has it back when they shut.
//
// The game's own Vehicle class, over a Rapier world with nothing in it, out in space. Nothing here is
// game data: a box of a fighter's size and round numbers.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../../src/core/physics.ts';
import { Vehicle, specFor, type DriveInput } from '../../../src/vehicles/vehicle.ts';
import { VehicleSounds } from '../../../src/audio/vehicleSounds.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const DT = 1 / 60;

/** A fighter flying out in space at a given cruise, its own spec for this run. */
async function flying(cruise: number): Promise<{ v: Vehicle; physics: Physics; scene: THREE.Scene; input: DriveInput }> {
  const physics = await Physics.create();
  const spec = specFor('ship', 'test', 'a made up fighter', { min: [-4, 0, -6], max: [4, 2, 6] });
  const scene = new THREE.Scene();
  const v = new Vehicle(spec, new THREE.Group(), physics, scene, 0, 2000, 0, 0);
  v.space = true;
  physics.stepOnce();
  v.cruise = cruise;
  const input: DriveInput = { throttle: 1, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, vertical: 0 };
  // A few steps at that speed with W held, so the hull is in flight and its numbers are settled.
  for (let i = 0; i < 10; i++) {
    v.update(DT, physics, input);
    physics.step(DT);
  }
  return { v, physics, scene, input };
}

function steps(v: Vehicle, physics: Physics, input: DriveInput, n: number): number[] {
  const seen: number[] = [];
  for (let i = 0; i < n; i++) {
    v.update(DT, physics, input);
    physics.step(DT);
    seen.push(v.cruise);
  }
  return seen;
}

function done(f: { v: Vehicle; physics: Physics; scene: THREE.Scene }): void {
  f.v.dispose(f.physics, f.scene);
  f.physics.world.free();
}

// --- 1: nothing lowered, nothing changed -------------------------------------------------------------
{
  const f = await flying(0);
  const top = f.v.spec.maxSpeed * 2;
  steps(f.v, f.physics, f.input, 60 * 15);
  ok(f.v.airborne && near(f.v.cruise, top, 1e-9), `1: with W held a fighter in space climbs to twice its top and holds it there (${f.v.cruise.toFixed(1)} m/s)`);
  f.input.throttle = 0;
  const coast = steps(f.v, f.physics, f.input, 120);
  ok(coast.every((c) => c === top), '1: and with W let go it coasts at that speed, as it always has');
  done(f);
}

// --- 2: a top lowered under a pilot holding W ----------------------------------------------------------
{
  const f = await flying(0);
  steps(f.v, f.physics, f.input, 60 * 15);
  const was = f.v.cruise;
  const brake = f.v.spec.brake;
  // What a nebula's hold on the engines does to the spec in one step.
  f.v.spec.maxSpeed *= 0.8;
  const lowTop = f.v.spec.maxSpeed * 2;
  const seen = steps(f.v, f.physics, f.input, 1);
  ok(near(seen[0], was - brake * DT, 1e-9), `2: with W held the cruise comes down at the brake, not to the new top in one step (${seen[0].toFixed(2)} after one step, ${lowTop.toFixed(1)} the new top)`);
  const rest = steps(f.v, f.physics, f.input, 60 * 10);
  ok(near(rest[rest.length - 1], lowTop, 1e-9) && rest.every((c, i) => i === 0 || c <= rest[i - 1] + 1e-9), '2: and settles on the new top without ever climbing back above it');
  f.v.spec.maxSpeed /= 0.8;
  const back = steps(f.v, f.physics, f.input, 60 * 10);
  ok(near(back[back.length - 1], was, 1e-9), '2: with the top put back it climbs to the old one at the engines\' own rate');
  done(f);
}

// --- 3: a top lowered under a pilot coasting --------------------------------------------------------------
{
  const f = await flying(0);
  steps(f.v, f.physics, f.input, 60 * 15);
  f.input.throttle = 0;
  const was = f.v.cruise;
  const brake = f.v.spec.brake;
  f.v.spec.maxSpeed *= 0.8;
  const lowTop = f.v.spec.maxSpeed * 2;
  const seen = steps(f.v, f.physics, f.input, 60 * 10);
  ok(near(seen[0], was - brake * DT, 1e-9), '3: with W let go the cruise comes down at the brake too, rather than coasting above the new top for good');
  ok(near(seen[seen.length - 1], lowTop, 1e-9), `3: and coasts on at the new top once it is down to it (${seen[seen.length - 1].toFixed(1)} m/s)`);
  done(f);
}

// --- 4: a boost's coast is left as it was -------------------------------------------------------------------
{
  const f = await flying(0);
  steps(f.v, f.physics, f.input, 60 * 15);
  f.input.boost = true;
  steps(f.v, f.physics, f.input, 60 * 10);
  const boosted = f.v.cruise;
  ok(boosted > f.v.spec.maxSpeed * 2, `4: a boost takes the fighter past its plain top (${boosted.toFixed(1)} m/s)`);
  f.input.boost = false;
  f.input.throttle = 0;
  const coast = steps(f.v, f.physics, f.input, 120);
  ok(coast.every((c) => c === boosted), "4: let go, the boost's coast above the plain top is kept, as it always was");
  done(f);
}

// --- 5: a winged fighter whose pilot's hand opens and shuts its wings -------------------------------------
// An NPC pilot's hand (`WingSet.brain`) over the flight rule, which in space has the wings open the whole time: shut, the
// hull reaches its full top; open, the top times the chassis's factor; and the wings' sound is asked for once each time
// they turn round, through the real VehicleSounds with no mixer behind it (it counts what it would have played).
{
  /** A winged fighter standing still out in space, launched into flight as an NPC ship is, with its pilot's hand as given. */
  const launched = async (brain: boolean | null) => {
    const physics = await Physics.create();
    const spec = specFor('ship', 'test', 'a made up winged fighter', { min: [-4, 0, -6], max: [4, 2, 6] });
    const scene = new THREE.Scene();
    const v = new Vehicle(spec, new THREE.Group(), physics, scene, 0, 2000, 0, 0);
    v.space = true;
    physics.stepOnce();
    for (let i = 0; i < 2; i++) v.wings.add({ pivot: new THREE.Object3D(), angle: 0.25, time: 1.5, open: 0, label: `foil${i}` });
    v.wingOpenFactor = 0.95;
    (v as { def: unknown }).def = { id: 'test', attachments: [{ kind: 'wing', sound: 'sound/test_wings_open.snd' }] };
    v.wings.brain = brain;
    v.launch(spec.maxSpeed);
    const input: DriveInput = { throttle: 1, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, vertical: 0 };
    return { v, physics, scene, input };
  };
  const f = await launched(false);
  const v = f.v;
  const sounds = new VehicleSounds();
  const fly = (n: number) => {
    for (let i = 0; i < n; i++) {
      v.update(DT, f.physics, f.input);
      f.physics.step(DT);
      sounds.update(DT, [v], null, null);
    }
  };
  const top = v.spec.maxSpeed * 2;
  // A patrol: launched with its pilot's hand shut, it arrives with the wings shut, where the flight rule would open them.
  ok(v.wings.progress === 0 && !v.wings.target, '5: launched with its pilot\'s hand shut, a patrol arrives with its wings shut');
  fly(60 * 15);
  ok(v.wings.progress === 0 && near(v.cruise, top, 1e-9), `5: and flies at its full top with them shut (${v.cruise.toFixed(1)} of ${top.toFixed(1)} m/s)`);
  const before = sounds.counts.wings;
  v.wings.brain = true;
  fly(60 * 10);
  ok(v.wings.progress === 1 && near(v.cruise, top * 0.95, 1e-9), `5: opened to fight, at the top times the chassis's factor (${v.cruise.toFixed(1)} m/s)`);
  ok(sounds.counts.wings === before + 1, `5: the wings' sound is asked for once as they open (${sounds.counts.wings - before})`);
  v.wings.brain = false;
  fly(60 * 10);
  ok(v.wings.progress === 0 && near(v.cruise, top, 1e-9), '5: shut again three seconds after the fight, it climbs back to its full top');
  ok(sounds.counts.wings === before + 2, '5: and the sound once more as they shut, and not on any frame between');
  // Snapped shut where they stand open (what a dock does to a ship it stands at its dock outright): nothing swung, so
  // nothing is heard, and the next time they really move the sound comes again.
  v.wings.brain = true;
  fly(60 * 10);
  ok(v.wings.progress === 1 && sounds.counts.wings === before + 3, '5: opened again, with its sound');
  v.wings.brain = false;
  v.snapWings(false);
  sounds.update(DT, [v], null, null);
  fly(60);
  ok(v.wings.progress === 0 && !v.wings.target && sounds.counts.wings === before + 3, `5: snapped shut, the wings are shut at once and no sound is asked for (${sounds.counts.wings - before - 3} asked)`);
  v.wings.brain = true;
  fly(60 * 10);
  ok(v.wings.progress === 1 && sounds.counts.wings === before + 4, '5: and swung open after it, the sound is asked for as ever');
  ok(!v.destroyed && v.airborne, '5: flown the whole time, never struck by anything');
  done(f);
  // The same hull with nobody's hand on it: the flight rule's, open in space the whole time.
  const g = await launched(null);
  ok(g.v.wings.progress === 1 && g.v.wings.target, '5: with no hand on them, a launch into space opens them, as the flight rule always did');
  // Held where it is by a dock (parked straight at one, or carried on another hull's back): the dock's hold folds them
  // while it holds the hull, which no other hold does, and letting go gives them back to the flight rule.
  const at = g.v.pos.clone();
  const turn = g.v.quaternion(new THREE.Quaternion());
  g.v.hold(null, at, turn);
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      g.v.update(DT, g.physics, null);
      g.physics.step(DT);
    }
  };
  step(60 * 3);
  ok(g.v.wings.progress === 1, '5: a hull some other hold has keeps its wings as they stand');
  g.v.wings.dockHold = true;
  step(60 * 3);
  ok(g.v.wings.progress === 0 && !g.v.wings.target, "5: a dock's hold folds them while the hull is held");
  g.v.wings.dockHold = false;
  g.v.release();
  step(60 * 3);
  ok(g.v.wings.progress === 1, '5: and let go, they open again under the flight rule, as the game reopened a docking ship\'s wings that had been open');
  done(g);
}

console.log(`\n${checks} checks passed`);
