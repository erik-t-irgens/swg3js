// A walking mobile's way up a step (src/world/mobiles/stepUp.ts), tried in a real physics world.
//
// `src/core/physics.ts` and rapier load under node, and so does `shape.ts`, so everything here is the
// game's own: the body is planned by `planBody` exactly as a person's is, built with the constructor's
// own damping, friction and mass, and walked through the very two calls `Mobile.act` makes about steps
// -- `onFeet`, which says whether it is walked this frame, and `walkStep`, which asks the probes when
// the last step held it back, lifts it, and notes the pace -- with the ground ray `Mobile.checkGround`
// casts, and stepped through the game's wrapper. The step-up it is given is the very ray
// `Physics.standingHit` answers.
//
// What is shown, and why each is worth showing:
//
//   1. The fault is real: with the step-up off, the body walks into a flight of steps and stands at
//      its foot. A test that climbed with it off would be testing nothing.
//   2. With it on, the same body walks up the same flight to the landing, at a slow walk, a walk and a
//      run, over a flight built as a triangle soup (a building's steps are one) and over one built of
//      boxes, and a flight wound inside out is climbed just the same.
//  2b. The Mos Eisley hospital's own shape: a street climbing nineteen degrees to a porch whose edge
//      stands 0.46 m over it. With the step-up off a person stalls at the edge. With it on a person
//      walking gets onto the porch and on across it -- and the lift is shown to rest on both of the
//      probe's two harder parts: the first low ray meets the climbing street, so it is the second
//      that finds the edge, and the edge stands more than the step over the body's own feet, so only
//      measuring from the riser's foot lets it be climbed at all. A hollow porch too tall over ground
//      that goes on rising under it is refused rather than stood inside.
//   3. A ledge too tall is refused: the body stands at its face, the probes say it was a wall, and a
//      body leaning on it asks again only every `retry` seconds. One just over the cap is refused
//      too, and one just under it is climbed, which pins the cap itself.
//   4. The lip: every ledge from 0.42 m to the cap, at every pace from a slow walk to a run, and a
//      person and a creature with a foot as wide as a bantha's, ends up on the tread and walks on
//      across it after one lift. Set straight up rather than onto the tread, all of these once ended
//      perched on the lip, or fell back down the face.
//   5. What it is not for: a ramp is walked by the solver with no lift at all; a body walking on
//      flat ground never asks; something standing in the way that moves -- another creature -- is
//      never stepped onto; a small creature whose template gives it a small step refuses a riser a
//      person climbs; and a tread with a wall close behind it, too narrow for the body, is refused.
//   6. The body's own filter decides what it climbs: at a spot where a building's shell stands too
//      tall and a room's own step low enough, a body indoors climbs the step and one outdoors is
//      refused by the shell.
//   7. A long creature, whose ground ray is cast from an origin that stands behind its support, is
//      walked on by its footing until that ray finds the tread, rather than left on the step with no
//      pace at all.
//
// And the wiring in `mobile.ts`, which drags three and the world in, is pinned as text: the very calls
// and arguments `act` makes.
//
// Synthetic throughout: every step, ledge and body below is written in this file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED_DT, Group, Physics, RAPIER, TRIMESH_FLAGS, cleanTrimesh, groups } from '../../../src/core/physics.ts';
import { planBody, type BodyInput } from '../../../src/world/mobiles/shape.ts';
import {
  STEP_FOUND,
  STEP_STATS,
  STEP_TUNE,
  easeShare,
  heldBack,
  onFeet,
  stepAhead,
  stepHeightOf,
  stepWalker,
  stoodStill,
  tuneStep,
  walkStep,
  type StepRay,
  type StepShape,
} from '../../../src/world/mobiles/stepUp.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mobileSrc = readFileSync(join(root, 'src', 'world', 'mobiles', 'mobile.ts'), 'utf8').replace(/\r\n/g, '\n');

await Physics.create();

/** The two filters a mobile walks with (`mobile.ts`): out of doors everything, indoors neither the terrain nor the shells. */
const OUTSIDE = groups(Group.all, Group.all);
const INSIDE = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));

/** How far under its feet a mobile's ground ray reaches (`Mobile.checkGround`: `this.plan.feet + 0.4` from the origin). */
const GROUND_REACH = 0.4;

/** A person, as the catalogue gives one: arms out in the bind pose, the template's own collision numbers. */
const PERSON: BodyInput = {
  hierarchy: 'all_b',
  flags: [],
  bounds: { min: [-0.85, 0, -0.2], max: [0.85, 1.8, 0.2] },
  collisionRadius: 0.5,
  collisionLength: 1.5,
  stepHeight: 0.5,
  swimHeight: 1,
  sizeClass: 'medium',
  scale: 1,
};

/** A small creature whose template gives it a small step, as 99 of the catalogue's templates do. */
const CRITTER: BodyInput = { ...PERSON, hierarchy: 'creature_base', bounds: { min: [-0.25, 0, -0.3], max: [0.25, 0.6, 0.3] }, collisionRadius: 0.3, stepHeight: 0.15, sizeClass: 'small' };

/** A creature with a foot as wide as a bantha's: an upright capsule 0.88 m round. */
const BROAD: BodyInput = { ...PERSON, hierarchy: 'creature_base', bounds: { min: [-1.2, 0, -2.2], max: [1.2, 2.2, 2.2] }, collisionRadius: 1.2, sizeClass: 'large' };

/**
 * A long creature whose model's box stands well ahead of its origin, so its support capsule does too:
 * its origin -- which its ground ray is cast from -- is a metre and a half behind the support.
 */
const LONG: BodyInput = { ...PERSON, hierarchy: 'creature_base', bounds: { min: [-0.4, 0, -0.5], max: [0.4, 0.9, 3.5] }, collisionRadius: 0.4, sizeClass: 'medium' };

type Mesh = { vertices: number[]; indices: number[] };

/** A quad, wound so its face points along `out` when `flip` is false. */
function quad(m: Mesh, a: number[], b: number[], c: number[], d: number[], flip: boolean): void {
  const base = m.vertices.length / 3;
  m.vertices.push(...a, ...b, ...c, ...d);
  if (flip) m.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  else m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * A flight of `n` steps of `rise` over `tread`, starting at z = `z0` and going up toward +z, then a
 * landing `landing` deep, all `half` wide either side of x = 0: risers and treads as a building's
 * steps are, a surface of triangles with nothing behind it.
 */
function flightMesh(n: number, rise: number, tread: number, z0: number, landing: number, half: number, flip = false): Mesh {
  const m: Mesh = { vertices: [], indices: [] };
  for (let s = 0; s < n; s++) {
    const y0 = s * rise;
    const y1 = (s + 1) * rise;
    const z = z0 + s * tread;
    // The riser, facing back down the flight (-z).
    quad(m, [-half, y0, z], [-half, y1, z], [half, y1, z], [half, y0, z], flip);
    // The tread on top of it, facing up; the last is the landing.
    const deep = s === n - 1 ? landing : tread;
    quad(m, [-half, y1, z], [-half, y1, z + deep], [half, y1, z + deep], [half, y1, z], flip);
  }
  return m;
}

interface World {
  physics: Physics;
}

/**
 * A world with a slab whose top is y = 0, and whatever `build` stands on it: the terrain out of doors,
 * or `floor` a room's own floor, which is what a body indoors stands on (it meets no terrain).
 */
function world(build: (w: RAPIER.World) => void, floor: number = Group.terrain): World {
  const physics = Physics.local();
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0).setCollisionGroups(groups(floor, Group.all)));
  build(physics.world);
  physics.stepOnce();
  return { physics };
}

function addMesh(w: RAPIER.World, m: Mesh, membership = Group.exterior): void {
  const clean = cleanTrimesh(new Float32Array(m.vertices), new Uint32Array(m.indices));
  assert.ok(clean, 'the drawn mesh survives cleaning');
  w.createCollider(RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS).setCollisionGroups(groups(membership, Group.all)));
}

/** A box standing on the floor from z = `z0` onward, `tall` high. */
const ledge = (tall: number, z0 = 3, deep = 20, membership = Group.all) => (w: RAPIER.World): void => {
  w.createCollider(RAPIER.ColliderDesc.cuboid(3, tall / 2, deep / 2).setTranslation(0, tall / 2, z0 + deep / 2).setCollisionGroups(groups(membership, Group.all)));
};

interface Walk {
  /** Where its feet ended. */
  x: number;
  y: number;
  z: number;
  /** The highest its feet reached. */
  top: number;
  lifts: number;
  asked: number;
  /** Frames it was walked on its footing alone, its ground ray finding nothing. */
  footing: number;
  /** Frames its feet were not walked at all: neither on the ground nor on a footing. */
  idle: number;
  /** The support's rim. */
  rim: number;
  /** At the first lift: which low ray met the face, the riser's foot the step was measured from, and the body's own feet then. */
  first: { low: number; foot: number; feet: number; top: number } | null;
}

/**
 * A body walked along +z from (0, 0, `startZ`) at `speed` for `seconds`, driven exactly as `Mobile.act`
 * drives one: its ground ray cast as `checkGround` casts it, `onFeet` asked whether it is walked, and
 * when it is, `walkStep` asked for the vertical speed and its velocity set along its heading at the
 * pace; when it is not, `stoodStill`. `climb` false is the game before the step-up.
 */
function walk(w: World, input: BodyInput, speed: number, seconds: number, climb: boolean, filter = OUTSIDE, startZ = 0): Walk {
  const plan = planBody(input);
  const support = plan.colliders[0];
  const physics = w.physics;
  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, plan.feet + 0.05, startZ).lockRotations().setLinearDamping(0.6).setAngularDamping(2.5),
  );
  for (const c of plan.colliders) {
    const desc = c.shape === 'ball' ? RAPIER.ColliderDesc.ball(c.radius) : RAPIER.ColliderDesc.capsule(c.half, c.radius);
    desc.setTranslation(c.at[0], c.at[1], c.at[2]).setMass(Math.max(0.5, c.mass)).setFriction(0.8).setCollisionGroups(filter);
    physics.world.createCollider(desc, body);
  }
  // Settle it on its feet before it sets off.
  for (let i = 0; i < 20; i++) physics.step(FIXED_DT);
  const hit: StepRay = { toi: 0, ny: 0 };
  const shape: StepShape = { along: support.at[2], rim: support.radius, step: stepHeightOf(input.stepHeight, input.scale), feet: plan.feet };
  const walker = stepWalker();
  const had = { ...STEP_STATS };
  const was = STEP_TUNE.on;
  tuneStep({ on: climb });
  let top = -Infinity;
  let footing = 0;
  let idle = 0;
  let first: Walk['first'] = null;
  const sx = 0;
  const sz = 1;
  try {
    for (let f = 0; f < Math.round(seconds / FIXED_DT); f++) {
      const now = f * FIXED_DT;
      const t = body.translation();
      const footY = t.y - plan.feet;
      top = Math.max(top, footY);
      const grounded = physics.groundDistance(t.x, t.y, t.z, plan.feet + GROUND_REACH, body, filter) !== null;
      if (onFeet(walker, grounded, footY)) {
        if (!grounded) footing++;
        const v = body.linvel();
        const lifts = walker.lifts;
        const vy = walkStep(physics, body, walker, now, grounded, speed, v.x, v.y, v.z, sx, sz, shape, t.x, footY, t.z, filter, hit);
        if (walker.lifts !== lifts && !first) first = { low: STEP_FOUND.low, foot: STEP_FOUND.foot, feet: footY, top: STEP_FOUND.top };
        body.setLinvel({ x: sx * speed, y: vy, z: sz * speed }, true);
      } else {
        idle++;
        stoodStill(walker);
      }
      physics.step(FIXED_DT);
    }
  } finally {
    tuneStep({ on: was });
  }
  const t = body.translation();
  const out = { x: t.x, y: t.y - plan.feet, z: t.z, top, lifts: walker.lifts, asked: STEP_STATS.asked - had.asked, footing, idle, rim: support.radius, first };
  physics.removeBody(body);
  return out;
}

const fmt = (w: Walk): string => `feet ${w.y.toFixed(2)} m up at z ${w.z.toFixed(2)}, ${w.lifts} lifts in ${w.asked} asks`;

// --- the numbers themselves ------------------------------------------------------------------------
ok(stepHeightOf(0.5, 1) === 0.5 && stepHeightOf(1.35, 1) === STEP_TUNE.most, `a body climbs its template's own step, capped at ${STEP_TUNE.most} m (a rancor's 1.35 is held to it)`);
ok(Math.abs(stepHeightOf(0.5, 0.5) - 0.25) < 1e-9 && stepHeightOf(0, 1) === 0 && stepHeightOf(undefined, 1) === 0.5, '... at its size, none for a template that says none, and the common 0.5 for one that says nothing');
ok(!heldBack(0, 1.8, 0, 1, 1.8) && heldBack(0, 0.1, 0, 1, 1.8) && !heldBack(0, 1.0, 0, 1, 1.8), 'held back is the step leaving it under half the pace it was pushed at along its heading');
ok(heldBack(1.8, 0, 0, 1, 1.8), '... so going as fast but sideways, turned off a wall, is held back too');
ok(!heldBack(0, 0, 0, 1, 0), '... and a body that was not pushed is never held back');
ok(easeShare(STEP_TUNE.ease * 3) < 0.06 && easeShare(0) === 1 && easeShare(1 / 60, { ...STEP_TUNE, ease: 0 }) === 0, `the picture catches up with a lift over about ${(STEP_TUNE.ease * 3).toFixed(2)} s, and at once with the ease off`);

// --- 1 and 2: a flight of steps, off and on --------------------------------------------------------
// Six risers of 0.2 m over 0.35 m treads, 1.2 m in all: about the Mos Eisley hospital's front steps,
// whose street stands at 4.0 and whose sill at 5.18.
const RISE = 0.2;
const FLIGHT = 6 * RISE;
const LAST_RISER = 3 + 5 * 0.35;
const stairs = (flip = false): World => world((w) => addMesh(w, flightMesh(6, RISE, 0.35, 3, 40, 3, flip)));
{
  const off = walk(stairs(), PERSON, 1.8, 8, false);
  ok(off.top < FLIGHT - 0.5 && off.z < 3 + 5 * 0.35, `1: with the step-up off a person walks into the flight and stands at its foot, as the Tusken at the hospital did (${fmt(off)})`);
  for (const speed of [0.9, 1.8]) {
    const on = walk(stairs(), PERSON, speed, 8, true);
    ok(Math.abs(on.y - FLIGHT) < 0.1 && on.z > LAST_RISER + on.rim + 1, `2: with it on the same person walks up all six steps and on across the landing at ${speed} m/s (${fmt(on)})`);
    ok(on.lifts >= 4 && on.lifts <= 12, `... a lift a step or so, not one a frame (${on.lifts})`);
  }
  const run = walk(stairs(), PERSON, 5.2, 5, true);
  ok(Math.abs(run.y - FLIGHT) < 0.1 && run.z > LAST_RISER + 5, `... and at a run (${fmt(run)})`);
  const flipped = walk(stairs(true), PERSON, 1.8, 8, true);
  ok(Math.abs(flipped.y - FLIGHT) < 0.1 && flipped.z > LAST_RISER + 1, `... and up a flight wound inside out, since which way a face was wound is the modeller's (${fmt(flipped)})`);
  const boxes = world((w) => {
    for (let s = 0; s < 6; s++) w.createCollider(RAPIER.ColliderDesc.cuboid(3, ((s + 1) * RISE) / 2, 0.35 / 2 + (s === 5 ? 2 : 0)).setTranslation(0, ((s + 1) * RISE) / 2, 3 + s * 0.35 + 0.35 / 2 + (s === 5 ? 2 : 0)));
  });
  const onBoxes = walk(boxes, PERSON, 1.8, 8, true);
  ok(Math.abs(onBoxes.y - FLIGHT) < 0.1 && onBoxes.z > LAST_RISER + 1, `... and up one built of boxes (${fmt(onBoxes)})`);
}

// --- 2b: the hospital's own shape ---------------------------------------------------------------------
// The Mos Eisley hospital's front, as measured in the game: the street climbs about nineteen degrees
// toward the porch -- 0.7 m over two here -- and the porch's edge stands 0.46 m over the street where
// they meet. A person walking up it stalls against the edge with its feet on the climbing street,
// about 0.57 m below the porch: more than the 0.5 m any body steps. So the lift rests on two things.
// Its first low ray, a tenth of a metre over those feet, meets the street climbing ahead of it before
// the edge and calls it a slope; the second, at half the step, is the one that meets the edge. And
// the step is measured from the riser's own foot, where the street meets the edge, and not from the
// body's feet, or the porch would be refused as a ledge too tall.
{
  const DULOK: BodyInput = { ...PERSON, bounds: { min: [-0.6, 0, -0.2], max: [0.6, 1.23, 0.2] } };
  const RAMP_RISE = 0.7;
  const EDGE = 0.46;
  const PORCH = RAMP_RISE + EDGE;
  const porch = (): World =>
    world((w) => {
      const angle = Math.atan2(RAMP_RISE, 2);
      const len = Math.hypot(RAMP_RISE, 2);
      const q = { x: -Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
      // A slab whose top face runs from (z 3, y 0) to (z 5, y 0.7).
      w.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.5, len / 2).setTranslation(0, RAMP_RISE / 2 - 0.5 * Math.cos(angle), 4 + 0.5 * Math.sin(angle)).setRotation(q));
      w.createCollider(RAPIER.ColliderDesc.cuboid(3, PORCH / 2, 15).setTranslation(0, PORCH / 2, 20));
    });
  const off = walk(porch(), PERSON, 1.8, 5, false);
  ok(off.top < PORCH - 0.3 && off.z < 5, `2b: with the step-up off a person walks up the street and stands at the porch's edge (${fmt(off)})`);
  for (const speed of [1.0, 1.8]) {
    const on = walk(porch(), PERSON, speed, 9, true);
    ok(Math.abs(on.y - PORCH) < 0.05 && on.z > 5 + on.rim + 1 && on.lifts === 1, `... with it on, a person walking at ${speed} m/s is set on the porch once and walks on across it (${fmt(on)})`);
    const f = on.first;
    ok(!!f && f.low === 1, `... its first low ray met the street, and the second found the edge (low ray ${f?.low})`);
    ok(!!f && f.top - f.feet > STEP_TUNE.most && f.top - f.foot <= STEP_TUNE.most && f.foot > f.feet + 0.05, `... and the edge stood ${f ? (f.top - f.feet).toFixed(2) : '?'} m over its feet, past the ${STEP_TUNE.most} m any body steps, but ${f ? (f.top - f.foot).toFixed(2) : '?'} m over the riser's own foot, which is what the step is measured from`);
  }
  const running = walk(porch(), PERSON, 4.4, 4, true);
  ok(Math.abs(running.y - PORCH) < 0.05 && running.z > 5 + 5, `... and at a run (${fmt(running)})`);
  const dulok = walk(porch(), DULOK, 1.8, 7, true);
  ok(Math.abs(dulok.y - PORCH) < 0.05 && dulok.z > 5 + dulok.rim + 1, `... and so is a body with a dulok's foot, 0.27 m round (${fmt(dulok)})`);

  // A porch as a building's is: a hollow shell of triangles, its edge taller than the step, over ground
  // that goes on rising under it. The ray down past the edge starts inside the shell, passes through it
  // and finds that ground a little over the feet; only the ray across, over that ground, meets the
  // edge again and refuses it -- or the body would be set inside the porch.
  const hollow = (): World =>
    world((w) => {
      const angle = Math.atan2(RAMP_RISE, 2);
      const q = { x: -Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
      // The same climb, carried on under the porch for four metres more.
      const len = Math.hypot(RAMP_RISE * 3, 6);
      w.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.5, len / 2).setTranslation(0, (RAMP_RISE * 3) / 2 - 0.5 * Math.cos(angle), 6 + 0.5 * Math.sin(angle)).setRotation(q));
      const top = RAMP_RISE + 0.62;
      const m: Mesh = { vertices: [], indices: [] };
      quad(m, [-3, 0, 5], [-3, top, 5], [3, top, 5], [3, 0, 5], false);
      quad(m, [-3, top, 5], [-3, top, 12], [3, top, 12], [3, top, 5], false);
      addMesh(w, m);
    });
  const refused = walk(hollow(), PERSON, 4.4, 4, true);
  ok(refused.lifts === 0 && refused.top < RAMP_RISE + 0.3, `... while a hollow porch 0.62 m over the ground at its edge is refused, and the body is never set inside it (${fmt(refused)})`);
}

// --- 3: a ledge too tall, one just over the cap, and one just under it -------------------------------
{
  const had = STEP_STATS.wall;
  const tall = walk(world(ledge(0.8)), PERSON, 1.8, 6, true);
  ok(tall.top < 0.2 && tall.z < 3 && tall.lifts === 0, `3: a ledge 0.8 m tall is refused: the body stands at its face (${fmt(tall)})`);
  ok(STEP_STATS.wall > had, '... and the probes say it was a wall');
  ok(tall.asked <= Math.ceil(6 / STEP_TUNE.retry) + 1, `... asked once every ${STEP_TUNE.retry} s it leans on it, not on every frame (${tall.asked} asks in 6 s)`);
  // The cap itself, and not the ray down starting inside a box too tall: 0.53 m is inside the ray's
  // reach over the step (`over`), so only the comparison with the step refuses it.
  const wall = STEP_STATS.wall;
  const over = walk(world(ledge(STEP_TUNE.most + 0.03)), PERSON, 1.8, 4, true);
  ok(over.lifts === 0 && over.top < 0.2 && STEP_STATS.wall > wall, `... and so is one ${(STEP_TUNE.most + 0.03).toFixed(2)} m tall, just over the ${STEP_TUNE.most} m cap (${fmt(over)})`);
  const under = walk(world(ledge(STEP_TUNE.most - 0.03)), PERSON, 1.0, 6, true);
  ok(Math.abs(under.y - (STEP_TUNE.most - 0.03)) < 0.03 && under.z > 3 + under.rim + 1 && under.lifts === 1, `... while one ${(STEP_TUNE.most - 0.03).toFixed(2)} m tall, just under it, is climbed and walked on across (${fmt(under)})`);
}

// --- 4: the lip ---------------------------------------------------------------------------------------
// Every ledge between the ground ray's own reach and the cap, at every pace from a slow walk to a run,
// for a person and for a creature with a foot as wide as a bantha's. Set straight up, all of these
// once ended on the lip -- the person short of the face with no pace at all, since the ground ray
// found nothing from there, and the broad body falling back down the face -- and now every one is
// set on the tread and walks on.
{
  let all = true;
  let worst = '';
  let idle = 0;
  for (const input of [PERSON, BROAD]) {
    for (const tall of [0.42, 0.45, 0.48]) {
      for (const speed of [0.5, 0.9, 1.8, 3.5]) {
        const seconds = Math.max(4, (3 + 2) / speed + 1);
        const r = walk(world(ledge(tall)), input, speed, seconds, true);
        const good = r.lifts === 1 && Math.abs(r.y - tall) < 0.03 && r.z > 3 + r.rim + 0.5;
        idle += r.idle;
        if (!good) {
          all = false;
          worst = `${input === PERSON ? 'person' : 'broad'} ${tall} m at ${speed} m/s: ${fmt(r)}`;
        }
      }
    }
  }
  ok(all, `4: every ledge from 0.42 to 0.48 m, at 0.5 to 3.5 m/s, a person and a broad creature alike, is climbed with one lift and walked on across${worst ? ` (not ${worst})` : ''}`);
  ok(idle === 0, `... and not one frame of any of those walks left the body unwalked (${idle})`);
}

// --- 5: what it is not for ---------------------------------------------------------------------------
{
  // A ramp at thirty degrees: the solver walks it, and nothing is lifted.
  const angle = Math.PI / 6;
  const ramp = world((w) => {
    const q = { x: -Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
    w.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.5, 6).setTranslation(0, 6 * Math.sin(angle) - 0.5 * Math.cos(angle), 3 + 6 * Math.cos(angle) - 0.5 * Math.sin(angle)).setRotation(q));
  });
  const up = walk(ramp, PERSON, 1.8, 5, true);
  ok(up.lifts === 0, `5: a ramp at thirty degrees is the solver's to walk and is never lifted onto (${fmt(up)})`);
  const flat = walk(world(() => {}), PERSON, 1.8, 3, true);
  ok(flat.asked === 0, `... a body walking over flat ground never casts a probe at all (${fmt(flat)})`);
  // A body standing in the way that is dynamic -- another creature, held where it stands -- is not a step.
  const blocker = world((w) => {
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.2, 3).lockTranslations().lockRotations());
    w.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.2, 0.3), b);
  });
  const into = walk(blocker, PERSON, 1.8, 4, true);
  ok(into.lifts === 0 && into.top < 0.2, `... something in the way that moves is never stepped onto, however low (${fmt(into)})`);
  const critter = walk(stairs(), CRITTER, 1.8, 6, true);
  ok(critter.lifts === 0 && critter.top < RISE, `... a small creature whose template gives it a 0.15 m step refuses a 0.2 m riser a person climbs (${fmt(critter)})`);
  // A 0.3 m step whose tread is a quarter of a metre deep, with a wall two metres high behind it:
  // room for a foot, and none for the body. Set on that tread the body would be put half into the
  // wall, so it is refused (`room`).
  const walled = world((w) => {
    ledge(0.3, 3, 0.25)(w);
    w.createCollider(RAPIER.ColliderDesc.cuboid(3, 1, 0.5).setTranslation(0, 1, 3.25 + 0.5));
  });
  const wallHad = STEP_STATS.wall;
  const blocked = walk(walled, PERSON, 1.8, 3, true);
  ok(blocked.lifts === 0 && blocked.top < 0.2 && STEP_STATS.wall > wallHad, `... and a tread with a wall close behind it, too narrow for the body, is refused rather than stood on (${fmt(blocked)})`);
}

// --- 6: the body's own filter decides what it climbs ---------------------------------------------------
{
  // At one spot, a building's shell 0.8 m tall -- far too tall -- and a room's own step 0.3 m tall,
  // on a room's floor both kinds of body stand on. A body indoors neither meets nor probes the shell,
  // and climbs the step; a body outdoors meets the shell, probes it, and is refused.
  const both = (): World =>
    world((w) => {
      ledge(0.8, 3, 20, Group.exterior)(w);
      ledge(0.3, 3, 20, Group.interior)(w);
    }, Group.interior);
  const indoors = walk(both(), PERSON, 1.8, 5, true, INSIDE);
  ok(indoors.lifts === 1 && Math.abs(indoors.y - 0.3) < 0.03 && indoors.z > 3 + indoors.rim + 1, `6: a body indoors climbs a room's own step where a building's shell stands too tall, since it probes the rooms alone (${fmt(indoors)})`);
  const outdoors = walk(both(), PERSON, 1.8, 5, true, OUTSIDE);
  ok(outdoors.lifts === 0 && outdoors.top < 0.2, `... while a body outdoors, which meets the shell, probes it and is refused (${fmt(outdoors)})`);
  const rooms = world((w) => addMesh(w, flightMesh(6, RISE, 0.35, 3, 40, 3), Group.interior), Group.interior);
  const upstairs = walk(rooms, PERSON, 1.8, 8, true, INSIDE);
  ok(Math.abs(upstairs.y - FLIGHT) < 0.1 && upstairs.z > LAST_RISER + 1, `... and it climbs a room's own flight (${fmt(upstairs)})`);
}

// --- 7: a long creature walked on its footing ---------------------------------------------------------
{
  const plan = planBody(LONG);
  ok(plan.kind === 'long' && plan.colliders[0].at[2] > 1, `a long creature's support stands ${plan.colliders[0].at[2].toFixed(2)} m ahead of its origin, which its ground ray is cast from`);
  const r = walk(world(ledge(0.45, 3, 20)), LONG, 1.8, 8, true);
  ok(r.lifts >= 1 && r.footing > 0 && Math.abs(r.y - 0.45) < 0.05 && r.z > 3 + 2, `7: lifted with its support on the tread and its origin still over the ground below, it is walked on by its footing (${r.footing} frames) until its ray finds the tread, and goes on across (${fmt(r)})`);
  ok(r.idle === 0, `... and was never left standing on the step with no pace (${r.idle} frames)`);
}

// --- the probe on its own -------------------------------------------------------------------------------
{
  const w = stairs();
  const hit: StepRay = { toi: 0, ny: 0 };
  const top = stepAhead(w.physics, 0, 0, 2.7, 0, 1, 0.38, 0.5, OUTSIDE, hit);
  ok(Math.abs(top - RISE) < 1e-3 && Math.abs(STEP_FOUND.face - 0.3) < 1e-3 && STEP_FOUND.low === 0, `the probe from the foot of the flight finds the first tread at ${top.toFixed(3)} m, its face ${STEP_FOUND.face.toFixed(3)} m ahead by the first low ray`);
  ok(Number.isNaN(stepAhead(w.physics, 0, 0, 0, 0, 1, 0.38, 0.5, OUTSIDE, hit)), '... and from three metres short of it, nothing');
}

// --- the wiring, as text ---------------------------------------------------------------------------------
{
  const act = mobileSrc.slice(mobileSrc.indexOf('  private act('), mobileSrc.indexOf('  private stepShapeNow('));
  ok(/const feet = onFeet\(this\.stepWalk, this\.grounded, this\.pos\.y\);\s*const moving = this\.speed > 0\.05 && \(feet \|\| this\.flyer \|\| this\.swimming\)/.test(act), '`Mobile.act` walks a body on its feet as `onFeet` says, with its feet as `pos.y`');
  ok(
    act.includes(
      'const vy = walkStep(this.deps.physics, this.body, this.stepWalk, this.now, this.grounded && !this.flyer && !this.swimming, this.speed, v.x, v.y, v.z, sx, sz, this.stepShapeNow(), this.pos.x, this.pos.y, this.pos.z, this.inside ? INSIDE : OUTSIDE, stepHit);',
    ),
    '... asks `walkStep` exactly as this test does: never for a flyer, a swimmer or a body only on its footing, at its own pace, heading, shape, origin and feet, and with its own filter so indoors it probes the rooms',
  );
  ok(act.indexOf('walkStep(') < act.indexOf('this.body.setLinvel({ x: sx * this.speed, y: vy, z: sz * this.speed }, true);'), '... before it sets the velocity it walks on, which carries the dropped fall');
  ok(/\} else \{\s*if \(this\.grounded && tier\.move\) \{[\s\S]*?\}\s*stoodStill\(this\.stepWalk\);\s*\}/.test(act), '... and says so when it was not set walking');
  const shape = mobileSrc.slice(mobileSrc.indexOf('  private stepShapeNow('), mobileSrc.indexOf('  private noteLift('));
  ok(/s\.along = support \? support\.at\[2\] : 0;/.test(shape) && /s\.rim = support \? support\.radius/.test(shape) && /s\.step = stepHeightOf\(this\.entry\.size\?\.stepHeight, this\.scale\);/.test(shape) && /s\.feet = this\.plan\.feet;/.test(shape), '`Mobile.stepShapeNow` is its support, its template\'s own step height at its size, and its origin\'s height over its feet');
  const ground = mobileSrc.slice(mobileSrc.indexOf('  private checkGround('), mobileSrc.indexOf('  private think('));
  ok(ground.includes(`this.deps.physics.groundDistance(t.x, t.y, t.z, this.plan.feet + ${GROUND_REACH}, this.body, filter)`), `its ground ray reaches ${GROUND_REACH} m under its feet, as this test's walk casts it`);
  ok((mobileSrc.match(/resetStepWalker\(this\.stepWalk\)/g) ?? []).length === 4, '... and the step-up is put back when it changes hands, when it is stood again, when it gets up off a seat and when it is stood out of a building coming down');
  ok(/if \(this\.liftLagY !== 0 \|\| this\.liftLagZ !== 0\) this\.easeLift\(dt\);/.test(mobileSrc.slice(mobileSrc.indexOf('  update('), mobileSrc.indexOf('  private stepDriven('))), '... and the picture is eased after a lift on every frame the body is its own');
}

console.log(`\n${checks} checks passed`);
