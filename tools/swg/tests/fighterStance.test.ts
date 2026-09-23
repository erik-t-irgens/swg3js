// A fighter's body and its stance (src/world/fighterStance.ts, which src/world/npcs.ts runs).
//
// Four things are pinned here, and the first two are the ones that matter.
//
// **The body is really stopped.** Not a mirror of the physics: a real rapier world is built, a
// capsule of the fighter's own shape is put in it with a character controller set by the very
// function the game sets one with, and it is then walked into a wall, up a step it can climb, at a
// step it cannot, off a ledge and down a stair. Before this wave a fighter's place was written
// straight into a kinematic body and it walked through all of them, and its own stuck check is
// documented in `npcs.ts` as never having fired.
//
// **The numbers are the player's, and are read out of the player's own file to prove it.** The
// autostep, the slopes, the snap, the controller's skin and the capsule's radius are lifted from
// `Player.makeBody`, and the aim's gain, decay, caps and spine share from `Player.correctAim` and
// `AIM_SPINE_MAX`. This test reads `src/player/player.ts` as text and fails if either half drifts,
// the way `palette.test.ts` reads the stylesheet, so a change to the player is a failure here
// rather than a fighter that walks a little differently from everybody else.
//
// **The sign of the aim.** A turn to the fighter's left is positive and a tilt forward and down is
// positive, so the pitch runs the other way round from the angle it is measured against. That is
// the one piece of arithmetic here that is easy to get backwards and impossible to see in a hidden
// tab.
//
// **The floor outdoors is the planet's and not the engine's.** The heightfield colliders only
// exist within a few chunks of the player, so a fighter that has wandered off is over nothing at
// all; the terrain is a floor it may never go below, and only a floor, so a ramp still lifts it.
//
// Synthetic throughout: every shape, height and angle below is written in this file, and nothing
// comes from the game's own archives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Group, groups, Physics, RAPIER } from '../../../src/core/physics.ts';
import {
  FIGHTER_BODY,
  STANCE_TUNE,
  aimMode,
  applyBody,
  bodyShare,
  capsuleDrop,
  easeAngle,
  fallSpeed,
  fighterPush,
  settleFooting,
  spineShare,
  stanceFor,
  stepAimFix,
  tuneFighterBody,
  tuneStance,
  wrapAngle,
  type Footing,
} from '../../../src/world/fighterStance.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const playerSrc = readFileSync(join(root, 'src', 'player', 'player.ts'), 'utf8');

// --- 1: the numbers are the player's ------------------------------------------------------------
//
// Read out of the player's own file rather than typed again here, so a drift fails.

{
  const has = (text: string): boolean => playerSrc.includes(text);
  ok(has('controller.enableAutostep(0.5, 0.2, true)'), "the player's own autostep is half a metre with a tread of 0.2");
  ok(FIGHTER_BODY.autostep === 0.5 && FIGHTER_BODY.autostepWidth === 0.2, 'and a fighter climbs exactly that');
  ok(has('setMaxSlopeClimbAngle((55 * Math.PI) / 180)') && has('setMinSlopeSlideAngle((60 * Math.PI) / 180)'), "the player's slopes are 55 up and 60 before it slides");
  ok(near(FIGHTER_BODY.slopeClimb, (55 * Math.PI) / 180, 1e-12) && near(FIGHTER_BODY.slopeSlide, (60 * Math.PI) / 180, 1e-12), 'and a fighter walks the same ones');
  ok(has('enableSnapToGround(0.35)') && FIGHTER_BODY.snap === 0.35, 'the snap to the ground is the same 0.35');
  ok(has('createCharacterController(0.04)') && FIGHTER_BODY.offset === 0.04, "and so is the controller's skin");
  ok(has('const CAPSULE_RADIUS = 0.35;') && FIGHTER_BODY.radius === 0.35, "the capsule's radius is the player's, which is what a doorway and a corner care about");
  ok(has('const STAND_HALF_HEIGHT = 0.45;') && FIGHTER_BODY.standHalf === 0.45, "and its straight part is the player's too, so the shape that meets a lintel is the same 1.6 m");
  ok(has('setCharacterMass(80)') && FIGHTER_BODY.mass === 80, "the controller weighs the player's own 80 kg");
  ok(FIGHTER_BODY.halfHeight === 0.9, 'the aim point the rest of the game shoots at is the fighter’s own 0.9 m, which is not the capsule');
  ok(near(capsuleDrop(), -0.1, 1e-12), 'so the capsule is dropped a tenth of a metre under the body to put its feet where the body’s are');
  ok(near(FIGHTER_BODY.halfHeight + capsuleDrop() - FIGHTER_BODY.standHalf - FIGHTER_BODY.radius, 0, 1e-12), 'which is exactly the height at which its feet are the point it stands on');

  ok(has('const AIM_SPINE_MAX = 0.6;') && STANCE_TUNE.spineMax === 0.6, "the spine takes the player's own 0.6 rad of the aim before the body takes the rest");
  ok(has('const gain = Math.min(1, dt * 12);') && STANCE_TUNE.gain === 12, "the correction is taken at the player's own rate");
  ok(has('fix.yaw += (0 - fix.yaw) * Math.min(1, dt * 8);') && STANCE_TUNE.decay === 8, 'and eased away at the same one');
  ok(has('clamp(fix.yaw + dYaw * gain, -2.2, 2.2)') && STANCE_TUNE.maxYaw === 2.2, "the yaw's cap is the player's 2.2 rad");
  ok(has('clamp(fix.pitch - dPitch * gain, -0.8, 0.8)') && STANCE_TUNE.maxPitch === 0.8, "and the pitch's is 0.8");
  // The text is here because the *number* is the player's; that it is an early return past the
  // ease rather than a way into it is what section 4 below drives, which is the half of this pair
  // that has teeth. Pinning the line alone once let the opposite rule ship under it.
  ok(has('if (this.sinceShot < 0.35) return;') && STANCE_TUNE.afterShot === 0.35, 'the recoil is not chased for the same third of a second');
  ok(playerSrc.indexOf('if (this.sinceShot < 0.35) return;') > playerSrc.indexOf('fix.yaw += (0 - fix.yaw) * Math.min(1, dt * 8);'), 'and it returns *after* the ease, so the player holds the correction through a shot rather than losing it');
  ok(has('const GUN_READY_SECONDS = 5;') && STANCE_TUNE.ready === 5, "the combat carry lasts the player's own five seconds");
  ok(has('this.heading += diff * Math.min(1, dt * 16);') && STANCE_TUNE.bodyTurn === 16, 'and the body turns onto what the spine could not take at the same rate');
}

// --- 2: the tuning moves, and never into nonsense -----------------------------------------------

{
  tuneStance({ aimCone: 0.4 });
  ok(STANCE_TUNE.aimCone === 0.4, 'the stance knob moves what it is given');
  ok(STANCE_TUNE.aimShare === 1.25, 'and nothing it was not');
  tuneStance({ aimCone: -3, ready: -1 });
  ok(STANCE_TUNE.aimCone === 0 && STANCE_TUNE.ready === 0, 'nothing here goes negative: a cone of nought is a fighter that never raises its gun, which is legible');
  tuneStance({ ready: Number.NaN });
  ok(STANCE_TUNE.ready === 0, 'and a number that is not one is ignored rather than written');
  tuneStance({ ready: 5, aimCone: 0.9, aimShare: 1.25 });
  ok(STANCE_TUNE.ready === 5 && STANCE_TUNE.aimCone === 0.9, 'the baked numbers go back');

  tuneFighterBody({ radius: 0 });
  ok(FIGHTER_BODY.radius === 0.05, 'a capsule never goes to nought: the engine hands back a handle that is not a handle for one');
  tuneFighterBody({ radius: 0.35 });
  ok(FIGHTER_BODY.radius === 0.35, 'and the shipped radius goes back');
}

// --- 3: which carry it stands in ----------------------------------------------------------------

{
  const gun = { gun: true, combat: true, hasTarget: true, gap: 10, range: 22, offNose: 0 };
  ok(stanceFor({ ...gun, combat: false }) === 'relaxed', 'out of a fight a fighter carries its weapon down');
  ok(stanceFor({ ...gun }) === 'aim', 'with a gun, something to fight and that something in front of it, it aims');
  ok(stanceFor({ ...gun, hasTarget: false }) === 'ready', 'lately in a fight but with nothing in hand to aim at, the gun is up and not aimed');
  ok(stanceFor({ ...gun, gap: 40 }) === 'ready', 'a target out past the gun’s reach is not aimed at');
  ok(stanceFor({ ...gun, gap: 22 * 1.2 }) === 'aim', 'though it raises a little before the range, so the gun is up by the time it can fire');
  ok(stanceFor({ ...gun, offNose: 1.4 }) === 'ready' && stanceFor({ ...gun, offNose: -1.4 }) === 'ready', 'and one well off either side of the nose is not aimed at either');
  ok(stanceFor({ ...gun, offNose: -0.5 }) === 'aim', 'the cone is the same both ways round');
  ok(stanceFor({ ...gun, gun: false }) === 'ready', 'nothing with a blade ever aims: its stance is what `ready` plays for one');
  ok(stanceFor({ ...gun, gun: false, combat: false }) === 'relaxed', 'and out of a fight it walks with its hands down like anybody else');
  ok(stanceFor({ ...gun, gap: Number.NaN }) === 'ready', 'a distance that is not a number is not an aim');
}

// --- 4: the aim's arithmetic, and its signs -----------------------------------------------------

{
  const fix = { yaw: 0, pitch: 0 };
  // The barrel is pointing along +Z and the shot is going 0.3 rad to the fighter's left.
  stepAimFix(fix, 0.3, 0, 0, 0, 1, 'chase');
  ok(fix.yaw > 0, 'a barrel to the right of where the shot is going turns the spine to the left');
  ok(near(fix.yaw, 0.3, 1e-9), 'and one whole second of it takes the whole error, since the gain is 12 a second and it is capped at one');

  fix.yaw = 0;
  fix.pitch = 0;
  // The shot is going 0.2 rad *up* from where the barrel points.
  stepAimFix(fix, 0, 0.2, 0, 0, 1, 'chase');
  ok(fix.pitch < 0, 'a shot going above the barrel tilts the torso back, since a tilt forward and down is positive');
  ok(near(fix.pitch, -0.2, 1e-9), 'by exactly the error');

  fix.yaw = 0;
  fix.pitch = 0;
  const step = 1 / 60;
  stepAimFix(fix, 1, 0, 0, 0, step, 'chase');
  ok(near(fix.yaw, Math.min(1, step * 12), 1e-9), 'at a frame a sixtieth long it takes a fifth of the error, which is the gain');

  fix.yaw = 0;
  stepAimFix(fix, Math.PI - 0.1, 0, -Math.PI + 0.1, 0, 1, 'chase');
  ok(fix.yaw < 0, 'the difference of two headings is taken the short way round, so a target just past the back is a small turn and not a whole circle');
  ok(near(Math.abs(fix.yaw), 0.2, 1e-9), 'of exactly the short way’s size');

  fix.yaw = 0;
  fix.pitch = 0;
  for (let i = 0; i < 400; i++) stepAimFix(fix, 3, 3, 0, 0, step, 'chase');
  ok(near(fix.yaw, STANCE_TUNE.maxYaw, 1e-9), 'however far off the shot is, the yaw stops at its cap');
  ok(near(fix.pitch, -STANCE_TUNE.maxPitch, 1e-9), 'and the pitch at its own');

  for (let i = 0; i < 600; i++) stepAimFix(fix, 0, 0, 0, 0, step, 'ease');
  ok(Math.abs(fix.yaw) < 1e-3 && Math.abs(fix.pitch) < 1e-3, 'with nothing to aim at, the whole correction eases back to nothing');

  ok(near(spineShare(0.4), 0.4, 1e-12) && bodyShare(0.4) === 0, 'a small turn is all the spine');
  ok(near(spineShare(1.5), 0.6, 1e-12) && near(bodyShare(1.5), 0.9, 1e-12), 'a big one fills the spine and the body takes the rest');
  ok(near(spineShare(-1.5), -0.6, 1e-12) && near(bodyShare(-1.5), -0.9, 1e-12), 'and it divides the same way round to the right');
  for (const yaw of [-2.2, -0.9, -0.1, 0, 0.1, 0.9, 2.2]) ok(near(spineShare(yaw) + bodyShare(yaw), yaw, 1e-12), `the two shares of ${yaw} rad add back up to it`);

  ok(near(wrapAngle(Math.PI * 3), Math.PI, 1e-9) || near(wrapAngle(Math.PI * 3), -Math.PI, 1e-9), 'an angle is folded into half a turn either way');
  ok(near(easeAngle(0, 1, 2, 10), 1, 1e-12), 'an ease never overshoots however long the step');
  ok(near(easeAngle(0, 1, 0, 1), 0, 1e-12), 'and at no rate at all it does not move');
}

// --- 4b: a shot, a stagger and a gun put down, driven frame by frame ----------------------------
//
// The three modes are not two, and reading the recoil as an ease rather than a hold is the one
// mistake here that looks like a skip and is its opposite. This block does not read the rule: it
// runs the very loop `Npc.aimPose` runs, over a whole gun cycle, and measures what is left of a
// settled aim at the end of it.

{
  const step = 1 / 60;
  const want = 0.5;

  ok(aimMode({ aiming: false, sinceShot: 9, stunned: false }) === 'ease', 'with the gun down or nothing alive to point it at, the correction is let go');
  ok(aimMode({ aiming: true, sinceShot: 0.1, stunned: false }) === 'hold', "inside the recoil it is held where it stands, which is the player's own early return");
  ok(aimMode({ aiming: true, sinceShot: STANCE_TUNE.afterShot, stunned: false }) === 'chase', 'and chased again the instant the window is out');
  ok(aimMode({ aiming: true, sinceShot: 9, stunned: true }) === 'hold', 'a stagger holds it too: a body not moving itself has nothing worth measuring through');
  ok(aimMode({ aiming: true, sinceShot: 9, stunned: false }) === 'chase', 'and otherwise it is chased');

  // The loop, with the barrel where the correction has put it: the spine turns by `fix.yaw`, so
  // that is what the next frame measures, which is the feedback the real one has through the pose.
  const chase = (fix: { yaw: number; pitch: number }, mode: 'chase' | 'hold' | 'ease'): void => stepAimFix(fix, want, 0, fix.yaw, 0, step, mode);

  // Settle the aim on a target half a radian off, as a fighter standing and firing does.
  const fix = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 120; i++) chase(fix, 'chase');
  ok(near(fix.yaw, want, 1e-6), 'a fighter that has been aiming for two seconds is on its target');

  // Now a shot: 0.35 s of the recoil window, twenty-one frames of it.
  const settled = fix.yaw;
  for (let t = 0; t < STANCE_TUNE.afterShot; t += step) chase(fix, aimMode({ aiming: true, sinceShot: t, stunned: false }));
  ok(fix.yaw === settled, 'through the whole recoil window the aim does not move a thousandth: it is held, not eased');

  // What the wrong branch would have cost, measured rather than asserted, so the number in the
  // comment above is this file's own arithmetic and not a claim.
  const wrong = { yaw: settled, pitch: 0 };
  for (let t = 0; t < STANCE_TUNE.afterShot; t += step) stepAimFix(wrong, 0, 0, 0, 0, step, 'ease');
  ok(wrong.yaw < settled * 0.1, `easing it instead would throw ${(100 * (1 - wrong.yaw / settled)).toFixed(0)} per cent of a settled aim away between one shot and the next`);

  // And the whole cycle: shoot, wait the gun's own cooldown, shoot again. The barrel must be on
  // the target at every shot, or it wags at the target for as long as the fight lasts.
  const cycle = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 120; i++) chase(cycle, 'chase');
  let worst = 0;
  for (let shot = 0; shot < 8; shot++) {
    for (let t = 0; t < 0.5; t += step) {
      chase(cycle, aimMode({ aiming: true, sinceShot: t, stunned: false }));
      worst = Math.max(worst, Math.abs(cycle.yaw - want));
    }
  }
  ok(worst < 1e-6, `over eight shots at the gun's own rate the barrel never leaves the target (worst ${worst.toExponential(1)} rad)`);

  // The same eight shots read as an ease, which is what shipped: the barrel is measurably off the
  // target for most of every cycle.
  const wagging = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 120; i++) chase(wagging, 'chase');
  let worstWag = 0;
  for (let shot = 0; shot < 8; shot++) {
    for (let t = 0; t < 0.5; t += step) {
      chase(wagging, t < STANCE_TUNE.afterShot ? 'ease' : 'chase');
      worstWag = Math.max(worstWag, Math.abs(wagging.yaw - want));
    }
  }
  ok(worstWag > 0.4, `read as an ease instead it wanders ${((worstWag * 180) / Math.PI).toFixed(0)} degrees off the target inside every cycle`);

  // A stagger between shots holds it in the same way.
  const hurt = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 120; i++) chase(hurt, 'chase');
  const before = hurt.yaw;
  for (let i = 0; i < 12; i++) chase(hurt, aimMode({ aiming: true, sinceShot: 9, stunned: true }));
  ok(hurt.yaw === before, 'and a blow that staggers it does not cost it its aim either');

  // But the gun going down really does let it go, which is the player's own behaviour and the one
  // place the ease belongs.
  for (let i = 0; i < 600; i++) stepAimFix(hurt, 0, 0, 0, 0, step, aimMode({ aiming: false, sinceShot: 9, stunned: false }));
  ok(Math.abs(hurt.yaw) < 1e-3, 'with the weapon down it eases away to nothing after all');
}

// --- 5: the floor outdoors is the planet's, and only a floor ------------------------------------

{
  const f: Footing = { y: 5, fallVy: Number.NaN, grounded: false };
  settleFooting(f, 10);
  ok(f.y === 10 && f.grounded, 'outdoors a body below the ground is put on it, whatever the engine said');
  ok(Number.isNaN(f.fallVy), 'and it is standing, not falling');

  f.y = 12;
  f.grounded = true;
  f.fallVy = Number.NaN;
  settleFooting(f, 10);
  ok(f.y === 12, 'the ground is a floor and not a ceiling: a body up a ramp or on a rock stays where the controller put it');

  f.y = 12;
  f.grounded = false;
  f.fallVy = Number.NaN;
  settleFooting(f, 10);
  ok(f.fallVy === 0, 'a body the controller found nothing under starts to fall');

  f.y = 4;
  f.grounded = true;
  f.fallVy = 6;
  settleFooting(f, null);
  ok(f.fallVy === 6, 'the first frame of a blow that lifts a body keeps its arc although the floor is still under it');

  f.y = -80;
  f.grounded = false;
  f.fallVy = -3;
  settleFooting(f, null);
  ok(f.y === -80 && !f.grounded, "inside a building there is no terrain to fall back on: a dungeon's rooms go far below it and a clamp would drag a body up through its floor");

  // The lift is reported, because a floor of last resort that has to lift a body a whole height is
  // not a body walking down a dune and nothing else on the readout tells a fall from a walk.
  f.y = 5;
  f.grounded = false;
  f.fallVy = -3;
  ok(near(settleFooting(f, 10), 5, 1e-12), 'the settle says how far it had to lift a body');
  f.y = 12;
  f.grounded = true;
  f.fallVy = Number.NaN;
  ok(settleFooting(f, 10) === 0, 'and says nothing at all on an ordinary frame');

  // And the indoor floor of last resort: a room whose collision has been dropped under it.
  f.y = -40;
  f.grounded = false;
  f.fallVy = -26;
  ok(settleFooting(f, null, 3.5) === 0 && f.y === 3.5 && f.grounded && Number.isNaN(f.fallVy), 'a body in a room with no collision built keeps the height the last real frame gave it, standing rather than falling');
  f.y = 3.5;
  f.grounded = false;
  f.fallVy = -1;
  settleFooting(f, null, 3.5);
  ok(f.y === 3.5, 'and goes on keeping it, however long the player stays away');
  f.y = 900;
  settleFooting(f, 10, 3.5);
  ok(f.y === 3.5, 'the held height wins over the terrain outright: a room under a mountain is not lifted onto the mountain');
}

// --- 6: the body, in a real physics world -------------------------------------------------------
//
// One world, the fighters' own capsule and the fighters' own controller, walked into things.

const physics = await Physics.create();
const world = physics.world;
// A floor with no body of its own, which is what a room's and a building's colliders are.
world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0));
// A wall across the way at z = 4, and the steps and ramps beside it. Each block below stands its
// fighter in a lane of its own, so no earlier one is ever in the way of a later one.
world.createCollider(RAPIER.ColliderDesc.cuboid(20, 2, 0.25).setTranslation(0, 2, 4));
// A kerb 0.4 m high a fighter can climb, and a shelf 0.9 m high it cannot, each with two metres of
// tread on top so the autostep's minimum width is not what refuses them. The kerb again at 50, for
// walking off rather than onto.
world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.2, 2).setTranslation(30, 0.2, 2));
world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.45, 2).setTranslation(-30, 0.45, 2));
world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.2, 2).setTranslation(50, 0.2, 2));

/** A slab tilted about its X axis so that walking in +z goes up it; the angle is in degrees. */
function rampAt(x: number, degrees: number): void {
  const t = (-degrees * Math.PI) / 180;
  // Where the near end of its top face lands, so the slab can be raised until that edge is on the
  // floor: the body must be able to walk onto it rather than up to a lip.
  const y = 0.2 * Math.cos(t) - -3 * Math.sin(t);
  world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.2, 3).setTranslation(x, -y, 0).setRotation({ x: Math.sin(t / 2), y: 0, z: 0, w: Math.cos(t / 2) }));
}
// One at 30 degrees, well inside the 55 a fighter climbs, and one at 70, well outside it.
rampAt(70, 30);
rampAt(90, 70);

const DT = 1 / 60;

/** A fighter's body: the capsule `npcs.ts` makes, with a controller set the way `npcs.ts` sets one. */
function fighterAt(x: number, y: number, z: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController } {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + FIGHTER_BODY.halfHeight, z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(FIGHTER_BODY.standHalf, FIGHTER_BODY.radius).setTranslation(0, capsuleDrop(), 0), body);
  const controller = world.createCharacterController(FIGHTER_BODY.offset);
  applyBody(controller);
  return { body, collider, controller };
}

/** What `npcs.ts` passes: everything outdoors, and indoors neither the terrain nor the building's shell. */
const OUTSIDE = groups(Group.all, Group.all);
const INSIDE = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));

/**
 * The very loop `Npc.move` runs: the ground asked for plus the settle or the fall, through the
 * controller with the filter of the place it is in, the result written back, and the body told
 * where to be for the next step. `hold` is a room whose collision has been dropped.
 */
function walk(f: { body: RAPIER.RigidBody; collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController }, at: Footing & { x: number; z: number }, dx: number, dz: number, frames: number, filter: number = OUTSIDE, hold = false): void {
  for (let i = 0; i < frames; i++) {
    physics.step(DT);
    const holdY = at.y;
    const dy = hold ? 0 : fallSpeed(at, DT);
    f.controller.computeColliderMovement(f.collider, { x: dx * DT, y: dy, z: dz * DT }, undefined, filter, (c) => {
      const b = c.parent();
      return !b || b.isFixed();
    });
    const mv = f.controller.computedMovement();
    at.x += mv.x;
    at.y += mv.y;
    at.z += mv.z;
    at.grounded = f.controller.computedGrounded();
    settleFooting(at, null, hold ? holdY : null);
    f.body.setNextKinematicTranslation({ x: at.x, y: at.y + FIGHTER_BODY.halfHeight, z: at.z });
  }
}

{
  // Into the wall at 5 m/s for four seconds, which is twenty metres of walking at a wall four away.
  const f = fighterAt(0, 0, 0);
  const at = { x: 0, y: 0, z: 0, fallVy: Number.NaN, grounded: true };
  // One step first: a scene query sees nothing the world has not stepped over yet.
  walk(f, at, 0, 5, 240);
  ok(at.z < 4 && at.z > 3, `a fighter walked at a wall for four seconds stops at it (z ${at.z.toFixed(2)}, wall at 3.75)`);
  ok(near(at.z, 4 - 0.25 - FIGHTER_BODY.radius, 0.1), 'and stands its own radius off its face, not inside it');
  ok(at.grounded && near(at.y, 0, 0.05), 'still standing on the floor it walked along');
}

{
  // The kerb: 0.4 m, under the half-metre autostep.
  const f = fighterAt(30, 0, -2);
  const at = { x: 30, y: 0, z: -2, fallVy: Number.NaN, grounded: true };
  // Four metres at 3 m/s, which stops it in the middle of the kerb's own two-metre top.
  walk(f, at, 0, 3, 80);
  ok(at.z > 1, `a step of 0.4 m is climbed rather than leaned on (z ${at.z.toFixed(2)})`);
  ok(near(at.y, 0.4, 0.06), `and the body ends up on top of it (y ${at.y.toFixed(2)})`);
}

{
  // The shelf: 0.9 m, over the autostep. It is a wall.
  const f = fighterAt(-30, 0, -2);
  const at = { x: -30, y: 0, z: -2, fallVy: Number.NaN, grounded: true };
  walk(f, at, 0, 3, 180);
  ok(at.y < 0.2, `a step of 0.9 m is not climbed (y ${at.y.toFixed(2)})`);
  ok(at.z < 0, `and stops the body short of it (z ${at.z.toFixed(2)}, its face at 0)`);
}

{
  // Off the kerb the other way: the snap holds the ground rather than letting it leave it.
  const f = fighterAt(50, 0.4, 1);
  const at = { x: 50, y: 0.4, z: 1, fallVy: Number.NaN, grounded: true };
  walk(f, at, 0, -3, 120);
  ok(at.z < -2, `a fighter walks off a kerb rather than being held on it (z ${at.z.toFixed(2)})`);
  ok(near(at.y, 0, 0.05), `and ends on the floor below (y ${at.y.toFixed(2)})`);
  ok(at.grounded, 'standing, not falling');
}

{
  // Up a 30-degree ramp, which is what a fighter meets walking into a building or up a dune.
  const f = fighterAt(70, 0, -5);
  const at = { x: 70, y: 0, z: -5, fallVy: Number.NaN, grounded: true };
  walk(f, at, 0, 3, 120);
  ok(at.y > 1.5, `a slope of 30 degrees is walked up (y ${at.y.toFixed(2)} after six metres of walking)`);
  ok(at.grounded, 'on the ramp, not bouncing off it');
}

{
  // And at a 70-degree face, which is past the 55 the player climbs: a wall.
  const f = fighterAt(90, 0, -4);
  const at = { x: 90, y: 0, z: -4, fallVy: Number.NaN, grounded: true };
  walk(f, at, 0, 3, 120);
  ok(at.y < 0.5, `a slope of 70 degrees is not climbed (y ${at.y.toFixed(2)})`);
}

{
  // And where there is nothing at all -- which is a fighter more than a few chunks from the player,
  // whose heightfield has not been built -- the controller lets it fall and the terrain catches it.
  const f = fighterAt(400, 20, 400);
  const at = { x: 400, y: 20, z: 400, fallVy: Number.NaN, grounded: true };
  const ground = 17.5;
  for (let i = 0; i < 300; i++) {
    physics.step(DT);
    const dy = fallSpeed(at, DT);
    f.controller.computeColliderMovement(f.collider, { x: 0, y: dy, z: 2 * DT }, undefined, undefined, () => true);
    const mv = f.controller.computedMovement();
    at.x += mv.x;
    at.y += mv.y;
    at.z += mv.z;
    at.grounded = f.controller.computedGrounded();
    settleFooting(at, ground);
    f.body.setNextKinematicTranslation({ x: at.x, y: at.y + FIGHTER_BODY.halfHeight, z: at.z });
  }
  ok(near(at.y, ground, 1e-9) && at.grounded, `over ground the engine knows nothing about, the planet's own height holds the body up (y ${at.y.toFixed(2)})`);
  ok(at.z > 209, 'and it goes on walking while it does');
}

// --- 7: the filter a fighter walks by, indoors and out ------------------------------------------
//
// The claim is that a fighter inside a building meets the cells and the props and never the ground
// under the building or its outer shell, which is the rule the player walks by. It rests on two
// collision filters and nothing pinned them.

{
  const npcSrc = readFileSync(join(root, 'src', 'world', 'npcs.ts'), 'utf8');
  ok(npcSrc.includes('groups(Group.all, Group.all & ~(Group.terrain | Group.exterior))'), 'the indoor filter in npcs.ts is the player’s own');
  ok(npcSrc.includes('this.cell ? INSIDE_FILTER : OUTSIDE_FILTER'), 'and which of the two it walks by is the room it is in');

  // A slab in the terrain's group and another in a building shell's, side by side with an ordinary
  // room floor, and a fighter walked along each with each filter.
  world.createCollider(RAPIER.ColliderDesc.cuboid(6, 2, 6).setTranslation(150, 2, 0).setCollisionGroups(groups(Group.terrain, Group.all)));
  world.createCollider(RAPIER.ColliderDesc.cuboid(6, 2, 6).setTranslation(170, 2, 0).setCollisionGroups(groups(Group.exterior, Group.all)));
  world.createCollider(RAPIER.ColliderDesc.cuboid(6, 2, 6).setTranslation(190, 2, 0).setCollisionGroups(groups(Group.interior, Group.all)));

  for (const [x, what] of [
    [150, 'the terrain under a building'],
    [170, 'a building’s own outer shell'],
  ] as [number, string][]) {
    const a = fighterAt(x, 8, 0);
    const at = { x, y: 8, z: 0, fallVy: Number.NaN, grounded: true };
    walk(a, at, 0, 0, 120, INSIDE);
    ok(at.y < 3.5, `indoors a fighter falls straight through ${what} (y ${at.y.toFixed(2)})`);
    const b = fighterAt(x, 8, 3);
    const out = { x, y: 8, z: 3, fallVy: Number.NaN, grounded: true };
    walk(b, out, 0, 0, 120, OUTSIDE);
    ok(out.y > 3.9 && out.grounded, `and outdoors it stands on it (y ${out.y.toFixed(2)})`);
  }

  const c = fighterAt(190, 8, 0);
  const on = { x: 190, y: 8, z: 0, fallVy: Number.NaN, grounded: true };
  walk(c, on, 0, 0, 120, INSIDE);
  ok(near(on.y, 4, 0.05) && on.grounded, `a room's own floor holds it indoors (y ${on.y.toFixed(2)})`);
}

// --- 8: a room whose collision has been dropped -------------------------------------------------
//
// The case the readout could not tell from a walk: a building's colliders are built only near the
// player and dropped again beyond, while the room a body is in goes on answering. Here the room is
// simply not there -- no collider at all under the body, indoors -- which is exactly what a fighter
// left behind in a far building is standing in.

{
  // Well clear of the floor this file laid down, so the only thing under the body is the rule.
  const f = fighterAt(-420, 30, 0);
  const at = { x: -420, y: 30, z: 0, fallVy: Number.NaN, grounded: true };
  // Ten seconds of it, walking, with the room taken as solid: it falls, and nothing stops it.
  walk(f, at, 0, 2, 600, INSIDE);
  ok(at.y < -500, `taken as solid, a fighter in a room that has no colliders falls out of the world (y ${at.y.toFixed(0)} after ten seconds)`);

  const g = fighterAt(-460, 30, 0);
  const held = { x: -460, y: 30, z: 0, fallVy: Number.NaN, grounded: true };
  walk(g, held, 0, 2, 600, INSIDE, true);
  ok(held.y === 30, `told the room has no collision, it keeps the height it had (y ${held.y.toFixed(2)})`);
  ok(held.grounded && Number.isNaN(held.fallVy), 'standing, not falling, so nothing accumulates to be paid back when the colliders return');
  ok(held.z > 19, 'and it goes on walking meanwhile, which is what it did before it had a body at all');
}

// --- 9: the push knob reaches a fighter's own controller ----------------------------------------

{
  ok(fighterPush() === false, 'a fighter pushes no dynamic body, for the same reason the player does not');
  const c = world.createCharacterController(FIGHTER_BODY.offset);
  fighterPush(true);
  applyBody(c);
  ok(c.applyImpulsesToDynamicBodies() === true, 'and `__debug.pushBodies(true)` really reaches it');
  fighterPush(false);
  applyBody(c);
  ok(c.applyImpulsesToDynamicBodies() === false, 'and back off again');
  ok(c.characterMass() === FIGHTER_BODY.mass, "with the player's own 80 kg set outright rather than left at a default");

  // And the one allocation the controller makes unless it is handed somewhere to write: measured
  // here rather than taken from the engine's types, because "nothing allocated per frame" is a
  // rule of this project's and this is one object per fighter per frame.
  const f = fighterAt(-600, 2, 0);
  physics.step(DT);
  const out = { x: 0, y: 0, z: 0 };
  f.controller.computeColliderMovement(f.collider, { x: 0.05, y: -0.01, z: 0.02 }, undefined, OUTSIDE, () => true);
  ok(f.controller.computedMovement(out) === out, 'the movement is written into a vector of ours rather than into a new one every frame');
  ok(out.x > 0.049 && out.z > 0.019, 'and it really is the movement, not an untouched struct');
}

console.log(`${checks} checks passed`);
