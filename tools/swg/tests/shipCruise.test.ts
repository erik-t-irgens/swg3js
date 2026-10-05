// A ship in flight whose own numbers lower its top speed, driven for real (src/vehicles/vehicle.ts,
// `flyShip`): a nebula's hold on the engines, or a part knocked down, writes the spec again in one
// step, and the cruise must come down to the new top at the brake whether the pilot holds W or not.
//
// Before, holding W cut the cruise to the new top in a single step (ninety metres a second off a
// fighter in space as it crossed a nebula's edge), and letting go of W kept the old speed for good,
// inside a nebula whose whole point is that the ship is slower in it. A boost's coast, which is above
// the old top, is left exactly as it always was, and so is everything when nothing is lowered.
//
// The game's own Vehicle class, over a Rapier world with nothing in it, out in space. Nothing here is
// game data: a box of a fighter's size and round numbers.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics } from '../../../src/core/physics.ts';
import { Vehicle, specFor, type DriveInput } from '../../../src/vehicles/vehicle.ts';

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

console.log(`\n${checks} checks passed`);
