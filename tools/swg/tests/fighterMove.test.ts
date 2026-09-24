// Facing and travel as two numbers, the trigger as a burst, and the physics the cover search is
// really given (src/world/npcs.ts, src/world/mobiles/mobile.ts, src/core/physics.ts).
//
// Two halves, and they are different kinds of check on purpose.
//
// The first half is **run**: `src/core/physics.ts` and rapier both load under node, so the one
// thing this wave added to the engine -- a ray that answers "how far to the first thing that stands
// still" without making an object -- is built into a real world with a real crate and a real
// creature in it and asked the real question. The claim that decides whether cover means anything
// at all is that a body cannot hide behind the thing it is fighting, and that claim is a predicate
// on a ray rather than an argument, so it is tried here rather than reasoned about.
//
// The second half is **read**, the way `fighterPosture.test.ts` reads `player.ts`: `npcs.ts` and
// `mobile.ts` are browser modules that drag three and the whole world in, so the wiring in them is
// pinned as text. That is worth more than it looks. The split is not a feature you can point at --
// it is an audit, every site that read one heading checked for which of the two it meant -- and the
// three sites that had to change are exactly the three a regression would put back.
//
// Synthetic throughout: every box, height and place below is written in this file, and nothing
// comes from the game's own archives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, Physics, RAPIER, groups } from '../../../src/core/physics.ts';
import { GROUND_STEP, tuneGroundStep } from '../../../src/world/groundStep.ts';
import { aimPointFor } from '../../../src/world/fighterStance.ts';
import { askFromSkill, coverSearch, type CoverAsk, type CoverDeps } from '../../../src/world/cover.ts';
import { skillOfGroundTier } from '../../../src/world/groundSkill.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const npcSrc = readFileSync(join(root, 'src', 'world', 'npcs.ts'), 'utf8');
const mobileSrc = readFileSync(join(root, 'src', 'world', 'mobiles', 'mobile.ts'), 'utf8');

await Physics.create();

// --- 1: the ray the cover search is given ---------------------------------------------------------
//
// A world with a ground slab, one fixed crate and one dynamic body standing where the crate is not.
// The dynamic body is the creature a fighter is fighting, and the whole of this section is that it
// must never answer.

{
  const physics = Physics.local();
  const world = physics.world;
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -0.5, 0));
  // A crate two metres on a side standing four metres east of the origin.
  world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1).setTranslation(4, 1, 0));
  // And a body four metres north: dynamic, which is what every creature, vehicle and player is.
  const mover = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 4).lockTranslations().lockRotations());
  world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.35).setTranslation(0, 0, 0), mover);
  physics.stepOnce();

  const far = physics.blockDistance(0, 1, 0, 10, 1, 0);
  ok(far > 2.9 && far < 3.1, `the crate stops a ray three metres out (${far.toFixed(2)} m)`);
  ok(physics.blockDistance(0, 1, 0, 0, 1, 10) === Infinity, 'and the dynamic body standing squarely in the way stops nothing at all, which is the whole reason cover can mean something: a fighter cannot hide behind the creature it is fighting');
  ok(physics.blockDistance(0, 1, 0, -10, 1, 0) === Infinity, 'a clear line answers Infinity rather than a number a caller has to know to disbelieve');
  ok(physics.blockDistance(0, 1, 0, 0, 1, 0) === Infinity, 'and a segment of no length answers the same rather than dividing by nought');
  ok(physics.blockDistance(0, 3.5, 0, 10, 3.5, 0) === Infinity, 'a ray over the crate is not stopped by it, which is what tells crouch cover from hard cover');

  // The same question `cameraBlock` answers, since this is deliberately that predicate with
  // primitives: if the two ever disagree the cover search is looking at a different world from the
  // one the camera is.
  const camera = physics.cameraBlock({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }, null, false);
  ok(camera !== null && Math.abs(camera - far) < 1e-6, 'and it is `cameraBlock`’s own answer to the letter, which is the point of it being that predicate and not a new one');
}

// --- 2: the adapter the manager really builds ------------------------------------------------------
//
// Built here out of the same two engine calls `NpcManager.coverDeps` is built out of -- the ray
// above and `topSurface` with a fixed-or-bodiless predicate -- and asked for cover against a threat
// standing beyond a crate. The point is not that a spot is found (`cover.test.ts` proves the search
// itself); it is that the search finds one **through this adapter**, so the two engine calls are
// the right two and their arguments are in the right order.

{
  const physics = Physics.local();
  const world = physics.world;
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -0.5, 0));
  // A low wall between the body and the threat, standing between the two heights the rest of the
  // game shoots a body at: a shot aimed where shots are aimed at a kneeling body is stopped and one
  // aimed at a standing body goes straight over.
  const wall = 0.7;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, wall / 2, 0.4).setTranslation(0, wall / 2, 3));
  physics.stepOnce();

  const staticOnly = (c: RAPIER.Collider): boolean => {
    const b = c.parent();
    return !b || b.isFixed();
  };
  const OUTSIDE = groups(Group.all, Group.all);
  let blockerCalls = 0;
  const deps: CoverDeps = {
    blockers: (_x, _z, _reach, out, cap) => {
      blockerCalls++;
      if (cap < 1) return 0;
      // What `LayoutStreamer.blockersNear` hands over for that wall: a disc over its footprint and
      // the world height of its top.
      const b = out[0];
      b.x = 0;
      b.z = 3;
      b.radius = Math.hypot(2, 0.4);
      b.topY = wall;
      return 1;
    },
    hit: (ax, ay, az, bx, by, bz) => physics.blockDistance(ax, ay, az, bx, by, bz),
    floor: (x, z, fromY, maxDrop) => physics.topSurface(x, z, fromY, maxDrop, OUTSIDE, staticOnly) ?? Number.NaN,
    sameGround: () => true,
  };

  const ask: CoverAsk = { x: 0, y: 0, z: 0, tx: 0, ty: 0.9, tz: 12, reach: 12, hardCost: 0, indoors: false };
  askFromSkill(ask, skillOfGroundTier(3));
  coverSearch.forget();
  const spot = coverSearch.find(deps, ask, 1);
  ok(blockerCalls === 1, 'the search asks its blockers exactly once');
  ok(!!spot, 'and finds somewhere to stand behind the wall through the adapter the manager really builds');
  ok(spot!.kind === 'crouch', 'a wall a shade over a kneeling body’s chest is crouch cover, not hard cover');
  ok(spot!.z > 0 && spot!.z < 3, 'the spot is on this side of the wall, which is the side the body is on');
  ok(Number.isFinite(spot!.y) && Math.abs(spot!.y) < 0.05, 'and stands on the floor the downward ray found rather than on the height it was asked from');
  // The heights are the hitbox's, so a spot that is cover to a kneeling body is exactly one the
  // standing aim point clears: read them back rather than restating the numbers.
  ok(aimPointFor('crouch') < wall && aimPointFor('stand') > wall, `and the ${wall} m wall really does stand between the two aim points the rest of the game shoots a body at (${aimPointFor('crouch')} and ${aimPointFor('stand')}), which is what "crouch cover" means and is not a number of the search's own`);

  ask.indoors = true;
  const before = coverSearch.status().rays;
  ok(coverSearch.find(deps, ask, 2) === null && coverSearch.status().rays === before, 'indoors it answers none and casts nothing, because an object placed inside a building has no collision to stop a bolt with');
}

// --- 3: the movement's own numbers -----------------------------------------------------------------

{
  const legMax = GROUND_STEP.legMax;
  ok(legMax > 0 && legMax < Math.PI / 2, 'the legs may be held off the gun by something less than a right angle: there is no strafe clip in either game, so a body at ninety degrees would be drawn walking sideways with nothing to draw it with');
  ok(GROUND_STEP.closeIn > 0 && GROUND_STEP.closeIn < 1, 'a gunner backs off inside a share of its ring rather than at a second distance of its own');
  ok(GROUND_STEP.standoff > 0 && GROUND_STEP.standoff <= 1, 'and holds a share of its gun’s own range rather than a number in metres, so moving the range moves the ring with it');

  tuneGroundStep({ legMax: 0.5, spacing: 4 });
  ok(GROUND_STEP.legMax === 0.5 && GROUND_STEP.spacing === 4, 'the knob moves what it is given');
  tuneGroundStep({ legMax: -1 });
  ok(GROUND_STEP.legMax === 0, 'nothing here goes negative: a lean of nought is a body that turns to walk, which is legible');
  tuneGroundStep({ spacing: Number.NaN });
  ok(GROUND_STEP.spacing === 4, 'and a typo in the console cannot empty a number');
  tuneGroundStep({ legMax, spacing: 2.2 });
  ok(GROUND_STEP.legMax === legMax, 'the baked numbers go back');
  ok(tuneGroundStep(null) === GROUND_STEP && tuneGroundStep() === GROUND_STEP, 'and asking with nothing is a read');
}

// --- 4: the audit, read as text --------------------------------------------------------------------
//
// Which of the two numbers each site meant. These are the sites that had to change; a regression is
// a site that reads the wrong one again.

{
  ok(/\n  facing = this\.heading;/.test(npcSrc), 'a fighter carries a facing beside its heading, started on it');
  ok(npcSrc.includes('Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - this.facing'), 'whether the weapon comes up is measured off the **gun** and not off the feet, or a body sliding sideways with its gun squarely on you would drop out of the aimed carry for as long as it slid');
  ok(npcSrc.includes('if (corner) moveTo = corner;'), 'a room’s corner moves the feet now, where it used to turn the whole body: a gunner rounding one keeps its gun where it was');
  ok(npcSrc.includes('this.wish.x = ax * step;') && npcSrc.includes('let ax = Math.sin(this.heading);'), 'and the ground it asks for still goes along its own nose, which is the movement model this game has always had — the nose is simply not the gun any more');
  ok(/private get split\(\)[\s\S]{0,200}this\.skill\.strafe > 0/.test(npcSrc), 'the split is the tier’s strafe share and not a flag of its own, so the two bottom rungs are the body the owner already knows');
  ok(npcSrc.includes('if (!this.split) wantFace = wantHead;'), 'and a body that has not earned it has one number on every frame, exactly as before');
  ok(npcSrc.includes('if (this.leanOnly && Math.abs(off) <= Math.PI / 2 + 0.01) wantHead = wantFace + Math.sign(off) * lean;'), 'past what the legs could show, a **slide** is held to the lean and the gun stays where it is');
  ok(/const lean = this\.leanOnly \? this\.slideLean : GROUND_STEP\.legMax;\s*\n\s*if \(Math\.abs\(off\) > lean\) \{[\s\S]{0,220}\n\s*else wantFace = wantHead;/.test(npcSrc), '... while anything else turns the body and takes the gun with it, because a body walking to a crate behind it has stopped aiming at you and there is no backpedal pose in this rig to draw one with');
  // What that comes to rung by rung, since a table of shares is not a table of angles until
  // somebody does the arithmetic. It is the whole of why this matters: held to one ceiling, every
  // sliding rung circled at a right angle clamped back to sixty degrees, so tier 3 and tier 5 slid
  // at one speed in one direction and only the duty cycle told them apart.
  const leanOf = (t: number): number => Math.min(GROUND_STEP.legMax, Math.asin(Math.min(1, skillOfGroundTier(t).strafe)));
  const deg = (r: number): number => (r * 180) / Math.PI;
  ok(leanOf(1) === 0 && leanOf(2) === 0, 'the bottom two rungs do not lean at all, because they do not slide at all');
  ok(deg(leanOf(3)) > 15 && deg(leanOf(3)) < 25, `tier 3 leans about twenty degrees (${deg(leanOf(3)).toFixed(0)}), which its own spine fold takes whole, so its drawn body is not leaning at all`);
  ok(leanOf(3) < leanOf(4) && leanOf(4) < leanOf(5), 'and the ladder leans further the higher it goes, which is what makes the rungs tell apart by eye');
  ok(deg(leanOf(5)) > 50 && leanOf(5) <= GROUND_STEP.legMax, `the top rung leans ${deg(leanOf(5)).toFixed(0)} degrees, under the ceiling the legs impose and far enough past the spine’s own share to be visible on the body`);
  ok(/private get slideLean\(\)[\s\S]{0,260}Math\.min\(GROUND_STEP\.legMax, Math\.asin\(s\)\)/.test(npcSrc), 'and how far a slide may lean is the **tier’s** — the angle whose sine is its `strafe`, since that is the angle at which exactly that share of its speed goes sideways — under the ceiling every body shares, or the tier’s number is divided straight back out by the travel vector’s own normalise and every sliding rung leans alike');
  ok(npcSrc.includes('this.leanOnly = gap >= ring * GROUND_STEP.closeIn;'), 'and backing out of somebody’s face is the one move that is not a slide');
  ok(npcSrc.includes('this.slideUntil = Math.random() < skill.strafe ? this.now + GROUND_STEP.slideFor : this.now;'), 'the slide is a duty cycle and not a state: a body that slid whenever it could would be walking whenever it was shooting, and a walking body never goes down on one knee — so a slide that never stopped would have quietly taken the whole of the kneeling away');

  ok(/\n  facing: number;/.test(mobileSrc), 'a mobile carries one too');
  ok(mobileSrc.includes('Math.atan2(dx, dz) - this.facing'), '... and its carry reads it, which is the one rule the old single heading was lying to');
  ok(/if \(this\.now < this\.sidestepUntil && pace !== 'stand'\) want \+= this\.sidestep;[\s\S]{0,200}this\.heading \+=/.test(mobileSrc), 'the creatures’ side-step goes on the feet alone: twisting the weapon sixty degrees with them put the gun down for the whole step');
  // The one line the whole mobile half of the split rests on, and the one nothing pinned. `face` is
  // the **feet's** want here -- the heading is eased onto it -- and the corner lookup overwrites it
  // with the next point on the indoor path. Captured after that, `look` is the corner too and the
  // split is undone: an armed creature rounding a doorway would swing its gun onto the doorway. The
  // order is the whole of it, so the order is what is pinned.
  const lookAt = mobileSrc.indexOf('const look = face;');
  const cornerAt = mobileSrc.indexOf('if (corner) face = corner;');
  const stepAt = mobileSrc.indexOf("if (this.now < this.sidestepUntil && pace !== 'stand') want += this.sidestep;");
  ok(lookAt > 0 && cornerAt > 0 && lookAt < cornerAt, 'the gun’s own point is captured **before** the indoor corner overwrites the feet’s: taken three lines further down it is the corner too, and an armed creature rounding a doorway swings its weapon onto the doorway with the whole split undone and nothing to show for it');
  ok(stepAt > 0 && lookAt < stepAt, '... and before the side-step, which is the same trap from the other side');
  // Three sites, each named, rather than one bare string that occurs three times: the point is that
  // **each** of them puts the weapon back on the feet, and a bare match would pass with two gone.
  ok(/private placeAt\([\s\S]{0,400}?this\.facing = heading;/.test(mobileSrc), 'a body put down, lifted or first heard of from another browser has its weapon pointed the way its feet are, with no lean left over from before');
  ok(/private dropAim\(\)[\s\S]{0,600}?this\.facing = this\.heading;/.test(mobileSrc), '... one that has died or changed hands the same, or a corpse is left leaning on a target it is no longer thinking about');
  ok(/private stepDriven\([\s\S]{0,1400}?this\.facing = this\.heading;/.test(mobileSrc), '... and a driven one on every step, because only one angle crosses the wire and a keeper’s sliding gunner would otherwise moonwalk on every other browser');
}

// --- 5: the trigger and the ladder, read as text ---------------------------------------------------

{
  ok(npcSrc.includes('skill: GroundSkill | null = skillOfGroundTier(DEFAULT_TIER);'), 'a fighter holds its tier’s row as the object, never copied field by field, so the knob reaches a body already standing about');
  ok(!/this\.skill\.(reaction|scatterDeg|burst)\s*;?\s*\n\s*(this|const)\s+\w+ =\s*\1/.test(npcSrc), 'and nothing takes the fields out of it');
  ok(npcSrc.includes('fireStep(this.fire, skill, sdt)'), 'the trigger is a burst and a rest rather than a metronome, which is the creatures’ own shape and is the whole of why a fighter read as a machine');
  ok(npcSrc.includes('fireReset(this.fire, d.targetKey !== null ? (this.skill?.reaction ?? 0) : 0);'), 'it is put back to the start of a burst when the target changes, with the tier’s reaction before the first pull and nothing at all when the target is lost');
  ok(npcSrc.includes('willFire(skill, diff)'), 'and the cone it will pull the trigger inside is the tier’s discipline rather than one flat number');
  ok(npcSrc.includes('aimScatter(skill, Math.random(), Math.random(), this.scatter);'), 'a shot is thrown off by the tier’s own cone, evenly over its disc');
  ok(!/tmp\.x \+= \(Math\.random\(\) - 0\.5\) \* s;[\s\S]{0,80}tmp\.normalize\(\);\s*\n\s*\/\/ Its own gun/.test(npcSrc), '... and the old box thrown on x, y and z is behind the tier-0 branch rather than on the path');
  ok(npcSrc.includes("this.attackCd = Math.max(FIGHTER_TUNE.gunEvery, g.primary.fireTime * 2.5) + Math.random() * FIGHTER_TUNE.gunSpread;"), 'tier 0 still is the flat fighter this game had, which is what makes `__debug.fighters({ tier: 0 })` a real comparison and is why those three numbers are still read');
  ok(npcSrc.includes('this.fire.wait = Math.max(this.fire.wait, g.primary.fireTime);'), 'and the weapon’s own rate is a floor under every burst, so a tier-5 rocket launcher is not a tier-5 blaster');
}

// --- 6: the cover wiring, read as text -------------------------------------------------------------

{
  ok(npcSrc.includes('coverSearch.find(deps, ask, this.now)'), 'the one shared searcher is used and not a second of this file’s own, or its per-step budget would mean nothing');
  ok(!/new CoverSearch\(/.test(npcSrc), '... and none is ever made here');
  ok(npcSrc.includes('const here = coverSearch.test(deps, ask, this.pos.x, this.pos.y, this.pos.z);'), 'a body already behind something does not go looking for somewhere else to be');
  ok(/if \(here !== null\) \{[\s\S]{0,400}?this\.takeCover\(this\.pos\.x, this\.pos\.y, this\.pos\.z, here, t\.key/.test(npcSrc), '... it **claims** where it stands, which is not a nicety: unclaimed, the brain never says the word and the standoff ring slides the body straight back out from behind the very thing it was standing behind');
  ok(npcSrc.includes('coverDue(skill, this.now - this.coverAt)'), 'how often one body looks is its tier’s, which is a separate thing from the searcher’s own budget over every body there is');
  ok(npcSrc.includes('if (d.cover !== true) return false;'), 'and **whether** to look is the brain’s answer and not this file’s: the two rules that used to be written here are in `decide`, behind the one flag that keeps them off every creature in the game (`coverBrain.test.ts` is where they are now pinned)');
  ok(npcSrc.includes('floor: (x, z, fromY, maxDrop) => this.physics.topSurface(x, z, fromY, maxDrop, OUTSIDE_FILTER, staticOnly)'), 'the floor under a spot is found among the things that stand still');
  ok(npcSrc.includes('hit: (ax, ay, az, bx, by, bz) => this.physics.blockDistance(ax, ay, az, bx, by, bz)'), '... and so is whatever is in the way of a shot');
  ok(npcSrc.includes('sameGround: (ax, az, bx, bz) => outdoorNav.reachable(ax, az, bx, bz)'), 'whether a spot is even on this body’s own ground is the baked grid’s region ranks');
  ok(!/outdoorNav\.walkable\(/.test(npcSrc), '... and never `walkable`, whose blocked set is grown by a two-metre cell against a body two thirds of a metre wide and is false for practically every real spot, which is a trap worth a test of its own');
  ok(npcSrc.includes('ask.ty = t.pos.y + t.halfHeight;'), 'a spot has to break the line to the threat’s own aim point, which is where its shots really come from');
  ok(npcSrc.includes('ask.indoors = !!this.cell;'), 'and indoors the search refuses itself');
}

// --- 7: hard cover is a duck and not a door -------------------------------------------------------
//
// The one real bug the first cut of this wave shipped with, and the half of it that can be run is
// run: `test` must refuse indoors exactly as `find` does, or a body that walked its spot into a
// building goes on believing an answer the search would no longer give it. The rest is the wiring,
// which is `npcs.ts` and therefore text.
//
// What went wrong is worth writing down where it will be read. A spot blocked at a standing chest
// as well as a crouched one stops the body's own bolts as surely as the ones coming at it, and
// `postureFor` crouches a body standing in one -- and a crouched body carries no actions at all in
// the client's own data. So it fires nothing. The hold on such a spot was then renewed on every
// look for as long as the spot still tested as cover, and every tier above the bottom looks oftener
// than the hold is long (`coverEvery` 5, 3, 2 and 1.2 against a six-second hold), so it renewed for
// ever: a tier-5 gunner ducked behind a wall and stayed there for the rest of the evening, with the
// player unable to shoot it either, because hard cover is hard both ways.

{
  const physics = Physics.local();
  const world = physics.world;
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -0.5, 0));
  // A wall over a standing chest: hard cover, the kind that used to be a one-way door.
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1.2, 0.4).setTranslation(0, 1.2, 3));
  physics.stepOnce();
  const deps: CoverDeps = {
    blockers: () => 0,
    hit: (ax, ay, az, bx, by, bz) => physics.blockDistance(ax, ay, az, bx, by, bz),
    floor: () => 0,
  };
  const ask: CoverAsk = { x: 0, y: 0, z: 0, tx: 0, ty: 0.9, tz: 12, reach: 12, hardCost: 0, indoors: false };
  ok(coverSearch.test(deps, ask, 0, 0, 0) === 'hard', 'a wall over both aim points is hard cover: nothing can touch the body there and it cannot shoot back either');
  const rays = coverSearch.status().rays;
  ask.indoors = true;
  ok(coverSearch.test(deps, ask, 0, 0, 0) === null, '`test` refuses indoors exactly as `find` does, so a body that walked its spot into a building stops believing it');
  ok(coverSearch.status().rays === rays, '... and casts nothing doing it, which is the same measurement rather than the same claim');
  ask.indoors = false;

  ok(GROUND_STEP.hardFor > 0 && GROUND_STEP.hardFor < GROUND_STEP.coverHold, `a hole is held for less than the patience on the walk to one (${GROUND_STEP.hardFor} s against ${GROUND_STEP.coverHold} s): it is a duck, not a position`);
  ok(GROUND_STEP.hardRest > 0, 'and a body that has just left one will not take another for a while, or it drops straight back into the same wall');
  ok(GROUND_STEP.hardRest > GROUND_STEP.hardFor, '... for longer than it sat in it, so the fight moves on rather than stalling behind the same crate');
  // And the condition that made the renewal a loop is still there, which is why the rule may never
  // be "let the hold run out": most of the ladder looks oftener than the hold is long, so a hold
  // renewed at every look is a hold that never ends.
  let oftener = 0;
  for (let tier = 1; tier <= 5; tier++) if (skillOfGroundTier(tier).coverEvery < GROUND_STEP.coverHold) oftener++;
  ok(oftener >= 4, `${oftener} of the five rungs look oftener than the hold is long, so nothing here may lean on the hold expiring by itself`);
  ok(/private holdCover\(kind: CoverKind \| null\): void \{[\s\S]{0,400}?if \(kind === 'crouch'\) this\.coverUntil = this\.now \+ GROUND_STEP\.coverHold;/.test(npcSrc), 'cover a body can shoot out of is renewed for as long as it holds: that is a firing position and a body belongs in one');
  ok(/else if \(!this\.coverSettled\) \{\s*\n\s*this\.coverSettled = true;\s*\n\s*this\.coverUntil = this\.now \+ GROUND_STEP\.hardFor;/.test(npcSrc), '... while a hole gets its seconds **once**, from the moment the body is really in it, and is never renewed — which is the whole difference between a duck and a door');
  ok(/private dropCover\(\): void \{\s*\n\s*if \(this\.coverKind === 'hard' && this\.coverSettled\) this\.hardRestAt = this\.now \+ GROUND_STEP\.hardRest;/.test(npcSrc), 'and letting a hole go starts the rest — but only one the body really sat in, since a spot it merely gave up walking to has not cost it a moment behind anything');
  ok(npcSrc.includes('if (this.now < this.hardRestAt) ask.hardCost = Infinity;'), 'which the search hears as the price of a spot that is never picked, so the body presses forward or finds somewhere it can shoot from instead');
  ok(npcSrc.includes("if (here === 'hard' && this.now < this.hardRestAt) return false;"), '... and a body resting does not claim a hole it happens to be standing in either, or the rest would be a hold under another name');
}

// --- 8: what the cover search is offered, read as text --------------------------------------------
//
// `layoutStream.ts` is a browser module, so the two things that were wrong with the filler are
// pinned rather than run. Both are cheap and both were silent.

{
  const streamSrc = readFileSync(join(root, 'src', 'world', 'layoutStream.ts'), 'utf8');
  ok(streamSrc.includes('topY: o.y + Math.max(box.min.y, box.max.y)'), 'the top of a model box is its higher end and never `max.y` on trust: a pack converted before the BOX chunk was read componentwise carries its corners the other way round, and such a blocker reads shorter than the feet of anything standing beside it and is refused silently, with no ray cast');
  ok(streamSrc.includes('const hx = Math.abs(box.max.x - box.min.x) * 0.5;'), '... and its spans are extents for the same reason');
  ok(/const far = reach \+ b\.radius;\s*\n\s*if \(dx \* dx \+ dz \* dz > far \* far\) continue;/.test(streamSrc), 'and what stands near a point is a squared distance over a flat list rather than a `hypot` over the collider map: the map is as many as fourteen hundred objects, the fill runs four times a step, and the early exit only fires once two dozen have been **accepted** — so it walked the whole map exactly where cover matters most, which is a body standing in the open');
  ok(!/for \(const \[o\] of this\.colliders\)/.test(streamSrc), '... and nothing destructures an entry of that map any more, which allocated a pair per object per pass');
  ok(/private noteBlocker\(o: PlacedObject\): void/.test(streamSrc) && /private forgetBlocker\(o: PlacedObject\): void/.test(streamSrc), 'the list is filled and emptied in the same two places the colliders themselves are');
  ok(/get blockerCount\(\): number/.test(streamSrc), 'and it can be counted from the console, because nought of them in a town is a wire that was never connected rather than a world with no crates in it');
}

console.log(`${checks} checks passed`);
