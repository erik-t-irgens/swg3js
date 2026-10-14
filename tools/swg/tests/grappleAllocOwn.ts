// The grapple's own code over whole frames, with the engine's answers kept: test 17 (d) of `grapple.test.ts` runs this
// in a node process of its own and reads the one line of JSON it prints. Not a test itself.
//
// Why a process of its own: in one that has also run the real engine, every call site the hook makes into the engine,
// the controller and the body has met two kinds of object, and a call that is no longer monomorphic is not inlined
// and boxes the numbers it hands over (measured: 16 to 50 B a frame of the stubs' own calls, which the game, whose
// engine calls are always the engine's, never pays). Here the hook only ever meets the kept answers, so what the
// young generation grows by over a frame is the hook's own: the sway, both reels, the haul and its lip-over, the
// drags, the constraint and its correction, the collider sync, the clip and the wall it finds, the carry, the wrap's
// sweep and fan, the bend made at the lip, the anchor's check, the mark shown and held, and wave 2's `look` (the
// clocks, the camera's pull, the lean toward the rope and the arm's weight and way). It never touches the
// real engine's world, but Rapier is loaded for the kept ray, triangle and contact record the hook makes once.
//
// Run: node --expose-gc --allow-natives-syntax tools/swg/tests/grappleAllocOwn.ts
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { GRAPPLE_TUNE, Grapple, type GrappleBody } from '../../../src/player/grapple.ts';
import { Group, RAPIER, type Physics } from '../../../src/core/physics.ts';

const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
if (!gc) {
  console.log(JSON.stringify({ skipped: 'run with node --expose-gc' }));
  process.exit(0);
}

// The building the scene hangs off, worked out by hand: a box from (-10, 0, -10) to (0, 20, 10), its lip along z at
// x 0, y 20. Every ray the hook casts is answered by the slab test against it, into one kept answer.
const B0x = -10;
const B0y = 0;
const B0z = -10;
const B1x = 0;
const B1y = 20;
const B1z = 10;
const stubCol = {
  handle: 77,
  isValid: () => true,
  parent: () => null,
  collisionGroups: () => (Group.exterior << 16) | Group.all,
  setTranslation: (_t: { x: number; y: number; z: number }) => {},
  setRotation: (_r: { x: number; y: number; z: number; w: number }) => {},
};
const answer = { timeOfImpact: 0, normal: { x: 0, y: 0, z: 0 }, collider: stubCol };
type StubRay = { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } };
const boxCast = (r: StubRay): typeof answer | null => {
  const maxToi = reachOf.v;
  const ox = r.origin.x;
  const oy = r.origin.y;
  const oz = r.origin.z;
  const dx = r.dir.x;
  const dy = r.dir.y;
  const dz = r.dir.z;
  let tmin = 0;
  let tmax = maxToi;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  if (dx > -1e-12 && dx < 1e-12) {
    if (ox < B0x || ox > B1x) return null;
  } else {
    const ta = (B0x - ox) / dx;
    const tb = (B1x - ox) / dx;
    const t1 = ta < tb ? ta : tb;
    const t2 = ta < tb ? tb : ta;
    if (t1 > tmin) {
      tmin = t1;
      nx = dx > 0 ? -1 : 1;
      ny = 0;
      nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (dy > -1e-12 && dy < 1e-12) {
    if (oy < B0y || oy > B1y) return null;
  } else {
    const ta = (B0y - oy) / dy;
    const tb = (B1y - oy) / dy;
    const t1 = ta < tb ? ta : tb;
    const t2 = ta < tb ? tb : ta;
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = dy > 0 ? -1 : 1;
      nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (dz > -1e-12 && dz < 1e-12) {
    if (oz < B0z || oz > B1z) return null;
  } else {
    const ta = (B0z - oz) / dz;
    const tb = (B1z - oz) / dz;
    const t1 = ta < tb ? ta : tb;
    const t2 = ta < tb ? tb : ta;
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = 0;
      nz = dz > 0 ? -1 : 1;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  answer.timeOfImpact = tmin;
  answer.normal.x = nx;
  answer.normal.y = ny;
  answer.normal.z = nz;
  return answer;
};
// After the setup a ray is answered by a smaller rule (`near`). A ray from the street (east of the wall by more than
// the hand ever stands) toward the wall's face, near level, meets it half way along its reach; any other meets nothing,
// which is what every span of the rope under the lip and every line from the hand does.
const wall = { timeOfImpact: 0.5, normal: { x: 1, y: 0, z: 0 }, collider: stubCol };
const near = (r: StubRay): typeof answer | null => {
  if (!(r.origin.x > 3 && r.dir.x < -0.5 && r.dir.y < 0.2 && r.dir.y > -0.2)) return null;
  wall.timeOfImpact = reachOf.v * 0.5;
  return wall;
};
/** The reach the hook handed the stand-in cast, kept for the rule it asks, and that rule. */
const reachOf = { v: 0.5, rule: boxCast };
// The stand-in for the engine's cast, the call the hook hands its cast's reach to as a number. A call that is not built
// into its caller boxes the numbers handed to it, which is the boundary's cost and not the hook's (the engine's own, in
// the game, is what test 17's calibrations price), and the cumulative budget the compiler builds calls in by did not
// always reach this one: with `segment` and `castPassing` built into `probeMark`, the cast's reach was boxed on every
// frame of one run in about a dozen (16 B a frame, found by the sampling heap profiler and the inlining trace of the bad
// runs, every one of them that call). So the stand-in is one function, small enough that the compiler builds it into
// whatever calls it whatever its budget has left (its small-function rule, 27 bytes of bytecode or fewer), that keeps
// the reach in a record and asks its rule with no number at all. It stays the one function for the whole run (the rule
// it asks is what changes), since a call site that has met two functions is no longer built in at all. And its call to
// the rule meets both rules before anything else runs, for the same reason turned the other way: the rule is never built
// into `cast`'s own code, which the compiler counts in when it sizes `cast` up (`cast` with `near` built into it was 122
// bytes to the small-function rule, not 25, and was left out of `probeMark` and `stepThing` again). Twenty turns, since
// a function keeps no record of what it has called until it has been called a few times.
const cast = (r: StubRay, maxToi: number): typeof answer | null => {
  reachOf.v = maxToi;
  return reachOf.rule(r);
};
{
  const ray: StubRay = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 1, z: 0 } };
  for (let i = 0; i < 20; i++) {
    reachOf.rule = (i & 1) === 0 ? near : boxCast;
    cast(ray, 1);
  }
}
const stubWorld = {
  castRayAndGetNormal: cast,
  intersectionWithShape: () => null,
  gravity: { x: 0, y: -20.32, z: 0 },
};
/** From here on every ray is answered by the smaller rule. */
const useNear = (): void => {
  reachOf.rule = near;
};
const no = (_h: number): boolean => false;
const physics = { world: stubWorld, isPane: no, isRagdoll: no, isWalkThrough: no, isPeer: no, isWall: no, broken: false, behind: 0, steps: 0, markWalkThrough: (_c: unknown, _on: boolean) => {} } as unknown as Physics;
const contactAnswer = { normal1: { x: 1, y: 0, z: 0 }, collider: stubCol };
let frame = 0;
const controller = {
  numComputedCollisions: () => ((frame & 3) === 0 ? 1 : 0),
  computedCollision: (_i: number, _out: unknown) => contactAnswer,
};
const body: GrappleBody = {
  pos: { x: -0.6, y: 20, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  grounded: false,
  swimming: false,
  depth: Number.NEGATIVE_INFINITY,
  inside: false,
  physics,
  body: null as unknown as RAPIER.RigidBody,
  collider: stubCol as unknown as RAPIER.Collider,
  controller: controller as unknown as RAPIER.KinematicCharacterController,
  colliderOffsetY: 0.8,
  filter: 0x7fff7fff,
  jka: { holdApex: (_y: number) => {}, rolling: false, inSpecialJump: false },
  hp: 100,
  takeDamage: (_amount: number, _force: boolean, _kind: string) => false,
  vehicles: [],
  hullController: null,
  ground: Number.NEGATIVE_INFINITY,
};
const g = new Grapple(RAPIER, physics);
const DT = 1 / 60;
const pos = body.pos;
const vel = body.vel;
const keys = g.keys;

// The young generation over the frames, the cleanest of three tries. Each try starts from a full collection, then
// warms again what it may have thrown away, then empties the young generation with a minor one (which throws no
// code away), and reads the collections only after two turns of the loop, which is when the observer is told.
let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};
const FRAMES = 200_000;
/**
 * The loop that runs the frames, kept out of the optimizing compiler (with `--allow-natives-syntax`, which every test that
 * runs this file passes). Compiled on the stack, the measure's own loop built the frame's step into itself and the step's
 * own calls into that, within one shared budget, so whether the hook's every-frame helpers were built in turned on when
 * that compile happened: one run in two measured 23 to 39 B a frame of numbers boxed at calls left out (the look's
 * lengths, wave 3b), the next nothing. Interpreted, the loop makes nothing (its counter is a small integer and its
 * argument a boolean) and the step it calls is compiled as itself, as the player's update calls the hook in the game.
 */
function frames(step: (counting: boolean) => void, n: number): void {
  for (let k = 0; k < n; k++) step(false);
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler, as it was before.
}
async function measure(step: (counting: boolean) => void): Promise<{ made: number; scavenges: number }> {
  frames(step, 100_000);
  let best = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    gc!();
    await settle();
    frames(step, 50_000);
    gc!({ type: 'minor' });
    await settle();
    scavenges = 0;
    const before = young();
    frames(step, FRAMES);
    const made = young() - before;
    await settle();
    if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
    if (best.scavenges === 0 && best.made <= 0) break;
  }
  watch.disconnect();
  return best;
}

// Wave 3b's hull, run alone (`grappleAllocOwn.ts hull`, and `hull hang`), so the hook's call sites meet the stand-in
// vehicle, its body, its collider and the hull test's controller and nothing else: a pod's hull moving along +z at 40 m/s,
// read and led every frame, the rope on its rear face, the body towed 12 m behind it on the ground (or hung at minFree off
// the rear face, `hang`), so the frames, the lead, the pull by the reduced mass with the brake's budget, the slip, the
// tow's friction and damping, the walk-through marks, the hull test and its push-out, the relative clip, the carry round
// a moving pivot and the towed floor all run, and after them wave 2's `look` on that rope and the mark worked out with
// the vehicle handed over, its hull family's casts meeting the hull and missing it, the mark shown on the hull, held on
// it and lost (the game's `stepGrappleMark` runs it every frame on foot with a vehicle about). The hull's place and the
// physics' step count rise a frame at a time as a 60 Hz step would move them, and the body moves with the hull, so the
// rope's whole state is steady.
if (process.argv.includes('hull')) {
  useNear();
  const hang = process.argv.includes('hang');
  const V = 40;
  const tr = { x: 0, y: 1.4, z: 0 };
  const rot = { x: 0, y: 0, z: 0, w: 1 };
  const lin = { x: 0, y: 0, z: V };
  const ang = { x: 0, y: 0, z: 0 };
  const done = { pulls: 0, contactTests: 0, pushes: 0, hullCalls: 0 };
  const contact = { distance: 0.02, normal1: { x: 0, y: 0, z: -1 } };
  // The hull's collider: met by the hull test's push-out on one frame in eight, otherwise clear.
  const hullCol = {
    handle: 91,
    isValid: () => true,
    parent: (): unknown => hullBody,
    collisionGroups: () => (Group.exterior << 16) | Group.all,
    setSolverGroups: (_g: number) => {},
    contactShape: (_s: unknown, _p: unknown, _r: unknown, _o: number, _out: unknown): typeof contact | null => {
      done.contactTests++;
      if ((frame & 7) !== 0) return null;
      done.pushes++;
      return contact;
    },
  };
  const hullBody = {
    handle: 12,
    isValid: () => true,
    translation: () => tr,
    rotation: () => rot,
    linvel: () => lin,
    angvel: () => ang,
    mass: () => 900,
    numColliders: () => 1,
    collider: (_k: number) => hullCol,
    applyImpulseAtPoint: (_j: unknown, _a: unknown, _w: boolean) => {},
    isFixed: () => false,
  };
  const vpos = { x: 0, y: 1.4, z: 0 };
  const vehicle = {
    disposed: false,
    ghosted: false,
    destroyed: false,
    holding: false,
    held: false,
    landed: false,
    airborne: false,
    spec: { id: 'stand-in', bounds: { min: [-2.5, 0, -8], max: [2.5, 2.5, 8] }, animal: false, ship: false },
    pos: vpos,
    speed: V,
    body: hullBody,
    attitude: { x: 0, y: 0, z: 0, w: 1 },
    spin: { x: 0, y: 0, z: 0 },
    autopilot: { drive: {} },
    refits: 0,
    justHit: 0,
    def: null,
    colliderHandles: [91],
    wingStateOf: (_h: number) => 'none',
    pulled: (_j: unknown, _a: unknown) => {
      done.pulls++;
    },
  };
  // The hull test's own controller: the move it is asked for, allowed whole, with a contact on one frame in sixteen.
  const asked = { x: 0, y: 0, z: 0 };
  const hullContact = { normal1: { x: 0, y: 0, z: 1 } };
  const hullController = {
    computeColliderMovement: (_c: unknown, d: { x: number; y: number; z: number }, _f: unknown, _g: unknown, _p: unknown) => {
      asked.x = d.x;
      asked.y = d.y;
      asked.z = d.z;
      done.hullCalls++;
    },
    computedMovement: (out: { x: number; y: number; z: number }) => {
      out.x = asked.x;
      out.y = asked.y;
      out.z = asked.z;
      return out;
    },
    numComputedCollisions: () => ((frame & 15) === 0 ? 1 : 0),
    computedCollision: (_i: number, _out: unknown) => hullContact,
  };
  const hb = body as unknown as { vehicles: unknown[]; hullController: unknown; ground: number; grounded: boolean };
  hb.vehicles = [vehicle];
  hb.hullController = hullController;
  hb.ground = 0;
  // The mark's casts against the hull (§3.8, step 7): its family's ray is the frames' own kept ray, and a ray of that one
  // object is answered by the slab test against the hull's box where the stand-in physics has it (no turn, so its cast pose
  // is the world less the lead); every other ray by the small rule as before. One rule more for the stand-in cast to ask,
  // its function made once.
  const hullsRay = (g.hulls as unknown as { ray: StubRay }).ray;
  const hullBox = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };
  const hullAnswer = { timeOfImpact: 0, normal: { x: 0, y: 0, z: 0 }, collider: null as unknown };
  const hullRule = (r: StubRay): typeof answer | null => {
    if (r !== hullsRay) return near(r);
    const ox = r.origin.x;
    const oy = r.origin.y;
    const oz = r.origin.z;
    const dx = r.dir.x;
    const dy = r.dir.y;
    const dz = r.dir.z;
    let tmin = 0;
    let tmax = reachOf.v;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (dx > -1e-12 && dx < 1e-12) {
      if (ox < hullBox.x0 || ox > hullBox.x1) return null;
    } else {
      const ta = (hullBox.x0 - ox) / dx;
      const tb = (hullBox.x1 - ox) / dx;
      const t1 = ta < tb ? ta : tb;
      const t2 = ta < tb ? tb : ta;
      if (t1 > tmin) {
        tmin = t1;
        nx = dx > 0 ? -1 : 1;
        ny = 0;
        nz = 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (dy > -1e-12 && dy < 1e-12) {
      if (oy < hullBox.y0 || oy > hullBox.y1) return null;
    } else {
      const ta = (hullBox.y0 - oy) / dy;
      const tb = (hullBox.y1 - oy) / dy;
      const t1 = ta < tb ? ta : tb;
      const t2 = ta < tb ? tb : ta;
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = dy > 0 ? -1 : 1;
        nz = 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (dz > -1e-12 && dz < 1e-12) {
      if (oz < hullBox.z0 || oz > hullBox.z1) return null;
    } else {
      const ta = (hullBox.z0 - oz) / dz;
      const tb = (hullBox.z1 - oz) / dz;
      const t1 = ta < tb ? ta : tb;
      const t2 = ta < tb ? tb : ta;
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = 0;
        nz = dz > 0 ? -1 : 1;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    hullAnswer.timeOfImpact = tmin;
    hullAnswer.normal.x = nx;
    hullAnswer.normal.y = ny;
    hullAnswer.normal.z = nz;
    return hullAnswer as unknown as typeof answer;
  };
  const placeHullBox = () => {
    hullBox.x0 = tr.x - 2.5;
    hullBox.x1 = tr.x + 2.5;
    hullBox.y0 = tr.y;
    hullBox.y1 = tr.y + 2.5;
    hullBox.z0 = tr.z - 8;
    hullBox.z1 = tr.z + 8;
  };
  const ph = physics as unknown as { steps: number; behind: number };
  ph.behind = 0.004;
  ph.steps = 1;
  // The body's place behind the hull's rear face (z -8 in its frame), its feet's height, and the rope's anchor there.
  const back = hang ? 8 + GRAPPLE_TUNE.minFree + 0.35 : 8 + 12;
  const feetY = hang ? 1.4 + 1.25 - 0.6 - GRAPPLE_TUNE.ropeY : 0.05;
  const lead = () => tr.z + V * ph.behind;
  pos.x = 0;
  pos.y = feetY;
  pos.z = lead() - back;
  vel.x = 0;
  vel.y = 0;
  vel.z = V;
  hb.grounded = !hang;
  const hooked = g.attachHull(body, vehicle as never, 0, 1.4 + 1.25, -8, 0, 0, -1, hullCol as unknown as RAPIER.Collider);
  if (!hang) g.latch = true;
  hullAnswer.collider = hullCol;
  reachOf.rule = hullRule;
  // The mark's view, written as the game's `stepGrappleMark` writes it, with the world's vehicles handed over.
  const hv = g.view;
  const hat = { x: 0, y: 0, z: 0 };
  const noWaterHull = (_p: { x: number; y: number; z: number }): boolean => false;
  hv.vehicles = hb.vehicles as never;
  const mv = { x: 0, y: 0, z: 0 };
  const seenHull = { attached: 0, onHull: 0, marked: 0, towed: 0, taut: 0, pulled: 0, markOn: 0, markHeld: 0, markOff: 0, looked: 0 };
  const hstep = (counting: boolean) => {
    frame++;
    // A 60 Hz step a frame: the hull's place moves on, the body's with it.
    tr.z += V * DT;
    vpos.z = tr.z;
    ph.steps++;
    const a = frame * 0.05;
    pos.x = 0.03 * Math.sin(a);
    pos.y = feetY + 0.02 * Math.sin(0.7 * a);
    pos.z = lead() - back + 0.03 * Math.sin(1.3 * a);
    vel.x = 0.1 * Math.cos(a);
    vel.y = 0;
    vel.z = V;
    if (g.rope.length > back + 2) g.rope.length = back + 1;
    const pulls = done.pulls;
    g.refreshModes(body);
    g.beforeMove(body, DT);
    g.syncCollider(body);
    mv.x = vel.x * DT + g.corr.x;
    mv.y = vel.y * DT + g.corr.y;
    mv.z = vel.z * DT + g.corr.z;
    g.clip(body, mv);
    pos.x += mv.x;
    pos.y += mv.y;
    pos.z += mv.z;
    g.afterMove(body, DT);
    // Wave 2's rest of the frame on a rope that rides a hull: the clocks, the camera's pull, the lean and the arm.
    const lively = g.lively;
    if (lively) g.look(body, DT);
    // The mark after the step, as the game works it out: from behind the body toward the hull's rear, and up off it for a
    // share of every 64 frames, so its hull's cast both meets the hull and misses it, and the hold on a hull runs.
    placeHullBox();
    hat.x = pos.x;
    hat.y = pos.y + GRAPPLE_TUNE.ropeY;
    hat.z = pos.z;
    const up = (frame & 63) >= 40;
    hv.eyeX = pos.x;
    hv.eyeY = pos.y + 2;
    hv.eyeZ = pos.z - 4;
    hv.dirX = 0;
    hv.dirY = up ? 0.6 : 0;
    hv.dirZ = up ? 0.8 : 1;
    hv.orbit = 0;
    hv.hand = hat;
    hv.filter = body.filter;
    hv.exclude = null;
    g.probeMark(physics, noWaterHull, DT);
    if (counting) {
      if (g.attached) seenHull.attached++;
      if (g.onHull) seenHull.onHull++;
      if (g.hulls.markedCount > 0) seenHull.marked++;
      if (g.towed) seenHull.towed++;
      if (g.taut) seenHull.taut++;
      if (done.pulls > pulls) seenHull.pulled++;
      if (lively) seenHull.looked++;
      if (g.mark.vehicle && g.mark.shows && !g.mark.held) seenHull.markOn++;
      else if (g.mark.vehicle && g.mark.held) seenHull.markHeld++;
      else seenHull.markOff++;
    }
  };
  for (let k = 0; k < 600; k++) hstep(true);
  const hbest = await measure(hstep);
  console.log(JSON.stringify({ frames: FRAMES, made: hbest.made, scavenges: hbest.scavenges, hooked, seen: seenHull, done, attached: g.attached, why: g.lastLetGo }));
  process.exit(0);
}

// Wave 3c's other player's vehicle, run alone (`grappleAllocOwn.ts peer`, and `peer hang`), so the hook's call sites meet
// the peers' list and nothing else: a pod-sized box moving along +z at 40 m/s as their picture, glided toward states heard
// ten a second (each heard a few milliseconds early or late, so the relay's velocity moves as the game's does), the list's
// entry and stamp refilled after the player's update as `RemoteBodies.hullBoxes()` refills them, and the rope fastened
// on its top with `attachPeer`. Towed 20 m behind it on the ground, or hung at its rear face with the box test meeting
// the face on some frames (`hang`), the frames' peer slot, the smooth pose and its jump test, the rope's casts, fans and
// depth against the box by arithmetic, the box test, the relative clip, the carry round a moving pivot and the tow all
// run, and after them wave 2's `look` and the mark worked out with the peers handed over, its box cast meeting the vehicle
// and missing it, the mark shown on it, held on it and lost.
if (process.argv.includes('peer')) {
  useNear();
  const hang = process.argv.includes('hang');
  const V = 40;
  const obj = { position: { x: 0, y: 0.6, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  const entry = { id: 7, obj, mid: Float64Array.of(0, 1.25, 0), half: Float64Array.of(2.5, 1.25, 8), target: Float64Array.of(0, 0.6, 0), turn: Float64Array.of(0, 0, 0, 1), vel: Float64Array.of(0, 0, V), heardAt: 0 };
  const peers = { list: [entry], stamp: 0 };
  const pb = body as unknown as { peerHulls: unknown; grounded: boolean; ground: number };
  pb.peerHulls = peers;
  pb.ground = 0;
  // The relay's velocity as the game steps it, over gaps a few milliseconds off a tenth of a second (a fixed cycle of
  // them, so the steady state is one the measure can repeat).
  const clk = { t: 0, next: 0, last: 0, n: 0 };
  const jitter = [0.003, -0.002, 0.004, -0.004, 0.001, -0.003, 0.002, 0];
  const relayVel = { x: 0, y: 0, z: V };
  const k = 1 - Math.exp(-DT / 0.1);
  const glide = () => {
    clk.t += DT;
    if (clk.t >= clk.next) {
      const heard = clk.t + jitter[clk.n++ & 7];
      const z = V * clk.next;
      relayVel.z += ((z - entry.target[2]) / (heard - clk.last) - relayVel.z) * 0.25;
      entry.target[2] = z;
      entry.vel[2] = relayVel.z;
      entry.heardAt = heard;
      clk.last = heard;
      clk.next += 0.1;
    }
    obj.position.z += (entry.target[2] - obj.position.z) * k;
    peers.stamp = clk.t;
  };
  for (let i = 0; i < 60; i++) glide();
  // The body's place behind the box's rear face (z -8 in its frame): 20 m back on the ground, or within a hair of the face.
  const back = hang ? 8 + 0.35 + 0.02 : 8 + 20;
  const feetY = hang ? 0.6 + 1.25 - 0.8 : 0.05;
  pos.x = 0;
  pos.y = feetY;
  pos.z = obj.position.z - back;
  vel.x = 0;
  vel.y = 0;
  vel.z = V;
  pb.grounded = !hang;
  const hooked = g.attachPeer(body, 7, 0, 0.6 + 2.5, obj.position.z - 6, 0, 1, 0);
  if (!hang) g.latch = true;
  const hv = g.view;
  const hat = { x: 0, y: 0, z: 0 };
  const noWaterPeer = (_p: { x: number; y: number; z: number }): boolean => false;
  hv.peers = peers as never;
  const mv = { x: 0, y: 0, z: 0 };
  const seenPeer = { attached: 0, onPeer: 0, contacts: 0, looked: 0, markOn: 0, markHeld: 0, markOff: 0 };
  // The pose the rope rides, read where the frames keep it, so the hung body stands against the face the box test meets.
  const slot = g.hulls.peerSlotOf(entry as never);
  const pf = slot ? g.hulls.peerFrame(slot) : null;
  const pstep = (counting: boolean) => {
    frame++;
    const a = frame * 0.05;
    const faceZ = pf ? pf.np[2] - 8 : obj.position.z - 8;
    pos.x = 0.03 * Math.sin(a);
    pos.y = feetY + (hang ? 0.02 * Math.sin(0.7 * a) : 0);
    // Hung, the capsule's face rides the box's within a few centimetres, inside the grown box on some frames.
    pos.z = hang ? faceZ - 0.35 - 0.04 + 0.03 * Math.sin(1.3 * a) : obj.position.z - back + 0.03 * Math.sin(1.3 * a);
    vel.x = 0.1 * Math.cos(a);
    vel.y = 0;
    vel.z = V;
    if (g.rope.length > back + 6) g.rope.length = back + 5;
    const contacts = g.slipNow.contacts;
    g.refreshModes(body);
    g.beforeMove(body, DT);
    g.syncCollider(body);
    mv.x = vel.x * DT + g.corr.x;
    mv.y = vel.y * DT + g.corr.y;
    mv.z = vel.z * DT + g.corr.z;
    g.clip(body, mv);
    pos.x += mv.x;
    pos.y += mv.y;
    pos.z += mv.z;
    g.afterMove(body, DT);
    const lively = g.lively;
    if (lively) g.look(body, DT);
    glide();
    hat.x = pos.x;
    hat.y = pos.y + GRAPPLE_TUNE.ropeY;
    hat.z = pos.z;
    const up = (frame & 63) >= 40;
    hv.eyeX = pos.x;
    hv.eyeY = pos.y + 2;
    hv.eyeZ = pos.z - 4;
    hv.dirX = 0;
    hv.dirY = up ? 0.6 : 0;
    hv.dirZ = up ? 0.8 : 1;
    hv.orbit = 0;
    hv.hand = hat;
    hv.filter = body.filter;
    hv.exclude = null;
    g.probeMark(physics, noWaterPeer, DT);
    if (counting) {
      if (g.attached) seenPeer.attached++;
      if (g.onHull) seenPeer.onPeer++;
      if (g.slipNow.contacts > contacts) seenPeer.contacts++;
      if (lively) seenPeer.looked++;
      if (g.mark.peer && g.mark.shows && !g.mark.held) seenPeer.markOn++;
      else if (g.mark.peer && g.mark.held) seenPeer.markHeld++;
      else seenPeer.markOff++;
    }
  };
  for (let q = 0; q < 600; q++) pstep(true);
  const pbest = await measure(pstep);
  console.log(JSON.stringify({ frames: FRAMES, made: pbest.made, scavenges: pbest.scavenges, hooked, seen: seenPeer, attached: g.attached, why: g.lastLetGo, frame0: (g.vehicleReport(body) as { frames: string[] }).frames[0] }));
  process.exit(0);
}

// Wave 3's hooked prop, run alone (`grappleAllocOwn.ts prop`), so the hook's call sites meet the stand-in prop and
// nothing else: the tether dragging it, the yank pulling it in and F let go of mid-yank, the rope's end carried onto
// it from its mesh, the straight span's check, the guards, the arm's way and the mark shown while it holds. The yank's
// end and a fresh hook are run once before the measure (each happens once a shot, not once a frame).
if (process.argv.includes('prop')) {
  // Rays by the small rule from the start: the prop lies where the building's box would stand, and nothing here is a wall.
  useNear();
  const pmv = g.view;
  const pat = { x: 0, y: 0, z: 0 };
  const noWaterHere = (_p: { x: number; y: number; z: number }): boolean => false;
  const mesh = { position: { x: -4, y: 0.3, z: 0 }, quaternion: { x: 0, y: 0.38268343236508984, z: 0, w: 0.9238795325112867 } };
  const stand = { x: -4, y: 0.3, z: 0 };
  const done = { holds: 0, weightless: 0, kept: 0, stopped: 0, released: 0, weight: 0 };
  const prop = {
    label: 'crate',
    mesh,
    stand,
    lost: 400,
    recalls: 0,
    mass: 20,
    // Carried a small share of the way toward the point it is held at, as a body handed a velocity is, so the yank never
    // arrives inside the measure and the tether's drag never quite closes the gap.
    holdAt(p: { x: number; y: number; z: number }, _dt: number, weightless = true): void {
      mesh.position.x += (p.x - mesh.position.x) * 0.02;
      mesh.position.y += (p.y - mesh.position.y) * 0.02;
      mesh.position.z += (p.z - mesh.position.z) * 0.02;
      done.holds++;
      if (weightless) done.weightless++;
      else done.kept++;
    },
    stop(): void {
      done.stopped++;
    },
    release(_d: { x: number; y: number; z: number }, _power: number, _lift?: number): void {
      done.released++;
    },
    giveWeightBack(): void {
      done.weight++;
    },
  };
  g.propAt = (h: number) => (h === stubCol.handle ? prop : undefined);
  const col = stubCol as unknown as RAPIER.Collider;
  // The whole yank once, to its end: hooked 8 m off, F held until it is in and the rope lets go.
  pos.x = 4;
  pos.y = 0;
  pos.z = 0;
  pmv.dirX = -1;
  pmv.dirY = 0;
  pmv.dirZ = 0;
  g.attachThing(body, prop, stubCol.handle, -3.7, 0.3, 0, 1, 0, 0, col, physics);
  const hookedOnce = g.holding;
  keys.haul = true;
  let frames = 0;
  while (g.holding && frames < 600) {
    frames++;
    mesh.position.x += 0.2;
    g.afterMove(body, DT);
  }
  const yankedOnce = g.lastLetGo === 'yanked' && done.stopped === 1 && done.released === 1;
  keys.haul = false;
  mesh.position.x = -4;
  // Hooked again from where the loop's first frame stands the rope point, so the guard against a place written without a
  // reset sees nothing but the loop's own few centimetres a frame.
  pos.x = 6;
  g.attachThing(body, prop, stubCol.handle, -3.7, 0.3, 0, 1, 0, 0, col, physics);
  const seenProp = { tether: 0, yank: 0, letUp: 0, shows: 0 };
  let pframe = 0;
  const pstep = (counting: boolean) => {
    // The rope point walks to and fro 8 to 12 m from the prop, never more than a few centimetres a frame; F is held for
    // 40 of every 160 frames and the rope's length put back to 12 m as each yank begins, so the tether drags it again.
    const a = pframe * 0.03;
    const phase = pframe % 160;
    pframe++;
    pos.x = 6 + 2 * Math.sin(a);
    pos.z = 0.5 * Math.sin(0.5 * a);
    vel.x = 0.06 * Math.cos(a);
    vel.z = 0.2;
    if (phase === 0) g.rope.length = 12;
    keys.haul = phase < 40;
    const holdsBefore = done.holds;
    const weightBefore = done.weight;
    g.refreshModes(body);
    g.beforeMove(body, DT);
    g.afterMove(body, DT);
    g.look(body, DT);
    pat.x = pos.x;
    pat.y = pos.y + GRAPPLE_TUNE.ropeY;
    pat.z = pos.z;
    pmv.eyeX = pos.x + 3;
    pmv.eyeY = 1.6;
    pmv.eyeZ = pos.z;
    pmv.dirX = -1;
    pmv.dirY = 0;
    pmv.dirZ = 0;
    pmv.orbit = 0;
    pmv.hand = pat;
    pmv.filter = body.filter;
    pmv.exclude = null;
    g.probeMark(physics, noWaterHere, DT);
    // The stand-in prop wanders back toward its stand between yanks, as a crate let lie would not; it keeps the measure's
    // frames all of one kind of work.
    mesh.position.x += (-4 - mesh.position.x) * 0.01;
    if (counting) {
      if (done.holds > holdsBefore && keys.haul) seenProp.yank++;
      else if (done.holds > holdsBefore) seenProp.tether++;
      if (done.weight > weightBefore) seenProp.letUp++;
      if (g.mark.shows) seenProp.shows++;
    }
  };
  for (let k = 0; k < 8 * 160; k++) pstep(true);
  const pbest = await measure(pstep);
  console.log(JSON.stringify({ frames: FRAMES, made: pbest.made, scavenges: pbest.scavenges, seen: seenProp, hookedOnce, yankedOnce, holding: g.holding, bends: g.rope.n }));
  process.exit(0);
}

// Fastened 4 m back on the roof, then let down over the lip a frame at a time: the bend at the lip is made by the
// hook's own sweep against the box, as a walk off a roof makes it.
g.attachNow(body, -4, 20, 0, 0, 1, 0, stubCol as unknown as RAPIER.Collider, 12);
for (let i = 0; i <= 120; i++) {
  // Out over the lip at the roof's height, then down the wall's face.
  const t = i / 120;
  pos.x = t < 0.5 ? -0.6 + 2.1 * t : 0.45;
  pos.y = t < 0.5 ? 20 : 20 - 2.7 * (2 * t - 1);
  g.refreshModes(body);
  g.beforeMove(body, DT);
  g.afterMove(body, DT);
}
useNear();
const bentAtLip = g.rope.n === 1 && Math.abs(g.rope.contact[3] - 0) < 1e-3 && Math.abs(g.rope.contact[4] - 20) < 1e-3;
g.rope.length = g.rope.spent + 2;

// The mark's view, written as the game's `stepGrappleMark` writes it, from kept records.
const eye = { x: 6, y: 18, z: 0 };
const look = { x: -1, y: 0, z: 0 };
const orbit = { d: 0 };
const at = { x: 0, y: 0, z: 0 };
const mv = g.view;
const noWater = (_p: { x: number; y: number; z: number }): boolean => false;
const seen = { sway: 0, reelIn: 0, reelOut: 0, haul: 0, lip: 0, wall: 0, taut: 0, shows: 0, held: 0 };
const step = (counting: boolean) => {
  // The hand round a loop under the lip, never past it (the bend there holds) and never more than a few centimetres a
  // frame; the keys change every 128 frames: sway two ways, reel in, reel out, haul; and the view turns off the wall
  // to the sky for a share of every 64 frames, so the mark is lost and held.
  const a = frame * 0.05;
  const phase = (frame >> 7) % 6;
  frame++;
  pos.x = 0.45 + 0.1 * Math.sin(a);
  pos.y = 18.6 + 0.9 * Math.sin(0.7 * a) - GRAPPLE_TUNE.ropeY;
  pos.z = 0.4 * Math.sin(1.3 * a);
  vel.x = 0.5 * Math.cos(a);
  vel.y = -1 + Math.sin(0.3 * a);
  vel.z = 0.2;
  g.refreshModes(body);
  keys.swayX = phase < 2 ? (phase === 0 ? 0 : -1) : 0;
  keys.swayZ = phase === 0 ? 1 : 0;
  keys.reelIn = phase === 2;
  keys.reelOut = phase === 3;
  keys.haul = phase >= 4;
  g.beforeMove(body, DT);
  g.syncCollider(body);
  g.clip(body);
  g.afterMove(body, DT);
  // Wave 2's rest of the frame: the clocks, the camera's pull, the lean toward the rope and the arm.
  g.look(body, DT);
  at.x = pos.x;
  at.y = pos.y + GRAPPLE_TUNE.ropeY;
  at.z = pos.z;
  look.y = (frame & 63) < 40 ? 0 : 0.9;
  mv.eyeX = eye.x;
  mv.eyeY = eye.y;
  mv.eyeZ = eye.z;
  mv.dirX = look.x;
  mv.dirY = look.y;
  mv.dirZ = look.z;
  mv.orbit = orbit.d;
  mv.hand = at;
  mv.filter = body.filter;
  mv.exclude = null;
  g.probeMark(physics, noWater, DT);
  if (counting) {
    if (keys.swayX !== 0 || keys.swayZ !== 0) seen.sway++;
    if (keys.reelIn) seen.reelIn++;
    if (keys.reelOut) seen.reelOut++;
    if (g.hauling) seen.haul++;
    if (g.lipping) seen.lip++;
    if (g.lastImpact > 0) seen.wall++;
    if (g.taut) seen.taut++;
    if (g.mark.shows && !g.mark.held) seen.shows++;
    if (g.mark.held) seen.held++;
  }
};
for (let k = 0; k < 6 * 128; k++) step(true);

const best = await measure(step);
console.log(JSON.stringify({ frames: FRAMES, made: best.made, scavenges: best.scavenges, seen, bentAtLip, attached: g.attached, bends: g.rope.n }));
