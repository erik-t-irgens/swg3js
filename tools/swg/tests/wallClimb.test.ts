// Wave 4 of the animations, item B: the wall climb (src/player/wallClimb.ts), on the real Rapier through the grapple's
// harness (its body steps the game's movement, the ledges and the climb in the player's own places), at 30, 60 and 144
// frames a second:
//  - an upright face and a 70-degree one: W held into it starts the climb after `wallStart`, climbs at `wallSpeed.up`
//    along the face, hands over to a braced hang at the lip (the ledges' own place under it) and, W still held, tops out
//    onto the roof, alike at every rate;
//  - an overhang is refused, a walkable slope is walked and never climbed, a wall lower than the hands' reach is never
//    climbed, a brush along a wall and a tap into one never start it;
//  - sideways, down onto the ground (standing), the crouch's let-go, Space's jump off backward, the stamina's drain and
//    its let-go;
//  - walking free in the open asks no ray of the climb, and under `climb.wall` 'before' nothing is ever climbed.
import assert from 'node:assert/strict';
import { TestBody, box, ground, makePhysics, type Physics } from './grappleBody.ts';
import { CLIMB_TUNE, resetClimbTune, climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { LEDGE_CAPSULE, LEDGE_HANG } from '../../../src/player/ledge.ts';
import { WALL_ON, wallRateOf } from '../../../src/player/wallClimb.ts';
import { WALL_CLIPS, WALL_FACTS } from '../../../src/anim/wallClips.ts';
import { RAPIER } from '../../../src/core/physics.ts';
import { wedge } from './wallScenes.ts';

// Climbing II, phase 2: these scenes hold today's climbing (a lip grabbed by moving at it, a wall climbed by W pressed
// into it, the hang's keys as they were): every phase 2 switch at its 'before' setting, here and after every reset (the new
// controls are climbControls.test.ts's).
climbTwoBefore();

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const n3 = (v: number) => v.toFixed(3);
const FPS = [30, 60, 144] as const;

async function scene(build: (p: Physics) => void): Promise<Physics> {
  const p = await makePhysics();
  ground(p, 0);
  build(p);
  p.stepOnce();
  return p;
}

/** A body on the ground at (x, z), facing +z (the camera's forward), with no Force. */
function bodyAt(p: Physics, x: number, z: number, fps: number, y = 0): TestBody {
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(x, y, z);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.run(fps, 0.3);
  return b;
}

function runUntil(b: TestBody, fps: number, seconds: number, until: () => boolean): number {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    b.frame(1 / fps);
    if (until()) return (i + 1) / fps;
  }
  return Infinity;
}

function tap(b: TestBody, code: string, fps: number): void {
  b.key(code, true);
  b.frame(1 / fps);
  b.key(code, false);
}

const restore = () => {
  resetClimbTune();
  climbTwoBefore();
};
const onWall = (b: TestBody) => b.wall.phase === WALL_ON;

// ---- the clips' rates --------------------------------------------------------------------------------------------------
{
  const up = wallRateOf('wallUp', 1);
  const down = wallRateOf('wallDown', 1);
  ok(Math.abs(up * WALL_FACTS[WALL_CLIPS.up].stride - CLIMB_TUNE.wallSpeed.up) < 1e-12 && Math.abs(down * WALL_FACTS[WALL_CLIPS.down].stride - CLIMB_TUNE.wallSpeed.down) < 1e-12 && wallRateOf('wallStill', 1) === 0, `each clip plays at the climb's speed over its own stride (up ${n3(up)}, down ${n3(down)}, sideways ${n3(wallRateOf('wallLeft', 1))}, still 0), so its planted hands stay put`);
  ok(Math.abs(wallRateOf('wallUp', 1.2) * 1.2 - up) < 1e-12, 'a bigger figure plays its clip slower by its size (its stride is longer)');
}

// ---- up an upright face and a 70-degree one, topped out --------------------------------------------------------------------
for (const angle of [90, 70]) {
  const tops: number[] = [];
  const hands: number[] = [];
  for (const fps of FPS) {
    restore();
    const top = 4.5;
    const p = await scene((q) => wedge(q, angle, top));
    const b = bodyAt(p, 0, 1.0, fps);
    b.key('KeyW', true);
    const t0 = runUntil(b, fps, 3, () => onWall(b));
    ok(Number.isFinite(t0), `${angle}°, ${fps} fps: W held into the face starts the climb (${n3(t0)} s after the press, the wall reached and pressed into for climb.wallStart ${CLIMB_TUNE.wallStart} s)`);
    ok(b.wall.climbs === 1 && b.heading !== 0 ? Math.abs(Math.sin(b.heading)) < 1e-6 : true, `${angle}°, ${fps} fps: the body faces the face`);
    // The climb's rate up the face.
    const y0 = b.pos.y;
    b.run(fps, 1);
    const rise = b.pos.y - y0;
    const want = CLIMB_TUNE.wallSpeed.up * Math.sin((angle * Math.PI) / 180);
    ok(Math.abs(rise - want) < 0.02 && onWall(b) && b.wall.rigState === 'wallUp', `${angle}°, ${fps} fps: climbs ${n3(rise)} m in a second (wallSpeed.up along the face, its rise ${n3(want)})`);
    // The capsule held just off the face (its nearer sphere its skin off it).
    const hit = p.world.castRayAndGetNormal(new RAPIER.Ray({ x: b.pos.x, y: b.pos.y + 0.35, z: b.pos.z }, { x: 0, y: 0, z: 1 }), 5, true, undefined, undefined, b.collider);
    const perp = hit ? hit.timeOfImpact * Math.sin((angle * Math.PI) / 180) : NaN;
    ok(Math.abs(perp - 0.37) < 0.01, `${angle}°, ${fps} fps: the capsule's lower sphere stands ${n3(perp)} m off the face (its radius and the skin's 0.02)`);
    const staminaWas = b.stamina.value;
    // On up to the lip: the braced hang there.
    const tHang = runUntil(b, fps, 6, () => b.ledge.holding);
    ok(Number.isFinite(tHang), `${angle}°, ${fps} fps: reaching the lip the ledges take the body (${n3(tHang)} s more)`);
    hands.push(b.pos.y);
    ok(b.ledge.braced || angle !== 90, `${angle}°, ${fps} fps: hung braced at the lip (feet on the face)`);
    const G = b.ledge.hangGrip(1);
    ok(Math.abs(b.pos.y - (top - G)) < 1e-6, `${angle}°, ${fps} fps: handed over at the braced hang's own place under the lip (feet ${n3(b.pos.y)} = top less the hang's grip ${n3(G)})`);
    ok(staminaWas - b.stamina.value > 0, `${angle}°, ${fps} fps: the climb drained stamina (${n3(staminaWas - b.stamina.value)})`);
    // W still held: the top-out.
    const tTop = runUntil(b, fps, 5, () => !b.ledge.holding && !onWall(b) && b.grounded);
    b.key('KeyW', false);
    b.run(fps, 0.5);
    const run = top / Math.tan((angle * Math.PI) / 180);
    ok(Number.isFinite(tTop) && Math.abs(b.pos.y - top) < 0.05 && b.pos.z > 2 + run, `${angle}°, ${fps} fps: W still held climbs on up onto the roof (${n3(tTop)} s; feet at y ${n3(b.pos.y)}, z ${n3(b.pos.z)})`);
    tops.push(b.pos.y);
  }
  ok(Math.max(...hands) - Math.min(...hands) < 1e-6, `${angle}°: the hand-over is at one place at every rate`);
  ok(Math.max(...tops) - Math.min(...tops) < 0.045, `${angle}°: the top-out ends at one height at every rate, within the character controller's own 0.04 skin (${tops.map(n3).join(', ')})`);
}

// ---- the fix round: every face just past the climb limit is climbed, alike at every rate ----------------------------------
for (const angle of [56, 58, 60, 62]) {
  const starts: number[] = [];
  for (const fps of FPS) {
    restore();
    const p = await scene((q) => wedge(q, angle, 6));
    const b = bodyAt(p, 0, 0.6, fps);
    b.key('KeyW', true);
    const t0 = runUntil(b, fps, 3, () => onWall(b));
    const y0 = b.pos.y;
    b.run(fps, 1);
    b.key('KeyW', false);
    starts.push(t0);
    ok(Number.isFinite(t0) && b.pos.y - y0 > 0.6, `${angle}°, ${fps} fps: a face just past the ${LOCO_TUNE.slope.climb}° climb limit is climbed (on after ${n3(t0)} s, ${n3(b.pos.y - y0)} m up in the next second)`);
  }
  ok(Math.max(...starts) - Math.min(...starts) < 0.05, `${angle}°: the climb starts alike at 30, 60 and 144 fps (${starts.map(n3).join(', ')} s)`);
}

// ---- the fix round: in the air a Jedi Academy wall move keeps its own trigger ---------------------------------------------
{
  /** A body high beside a tall wall, falling with W held into it, Space pressed `press` seconds on: its special moves and climbs. */
  const fall = async (force: number, mode: 'on' | 'before', press: number, step: 'mended' | 'before' = 'before', fps = 144): Promise<{ specials: string[]; climbs: number; airClimb: boolean }> => {
    restore();
    CLIMB_TUNE.wall = mode;
    // Stairs II: the step-up's switch (its own day one is playerStepUp.test.ts). Under 'before' this scene is as it was written.
    LOCO_TUNE.step.rule = step;
    const p = await scene((q) => box(q, [-10, 0, 2], [10, 40, 4]));
    const b = new TestBody(p);
    b.jka.forceLevel = force;
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.place(0, 20, 1.6);
    b.grounded = false;
    b.key('KeyW', true);
    let airClimb = false;
    for (let i = 0; i < Math.round(press * fps); i++) {
      const air = !b.grounded;
      b.frame(1 / fps);
      if (air && b.wall.holding) airClimb = true;
    }
    b.key('Space', true);
    b.frame(1 / fps);
    b.key('Space', false);
    b.run(fps, 0.5);
    b.key('KeyW', false);
    restore();
    LOCO_TUNE.step.rule = 'mended';
    return { specials: b.specials.slice(), climbs: b.wall.climbs, airClimb };
  };
  for (const press of [0.3, 0.4, 0.7]) {
    const was = await fall(3, 'before', press);
    const now = await fall(3, 'on', press);
    ok(was.specials.includes('BOTH_FORCEWALLREBOUND_FORWARD') && now.specials.join() === was.specials.join() && now.climbs === 0, `144 fps, Space ${press} s into a fall beside a wall with W held: a Force 3 body rebounds off it as it did before the climb (${now.specials.join() || 'none'}; climbs ${now.climbs})`);
    // Stairs II: under the step-up's mend the same fall is what it was under the step-up as it was, at 144 and at 240 frames a
    // second, the climb off and on (the review of Stairs II: the controller calls a body pressed against a sheer wall in the
    // air grounded, and the mend synced its collider there, which at 144 and 240 took the rebound away; `StepUp.reach` leaves
    // such a body to the controller as it was). At 30 and 60 the body clings and does not rebound, under either rule: the
    // controller calls it grounded on every frame there, an older fault the mend does not touch.
    const sameAs = (a: { specials: string[]; climbs: number }, b: { specials: string[]; climbs: number }) => a.specials.join() === b.specials.join() && a.climbs === b.climbs;
    for (const fps of [144, 240]) {
      const was2 = [await fall(3, 'before', press, 'before', fps), await fall(3, 'on', press, 'before', fps)];
      const mended = [await fall(3, 'before', press, 'mended', fps), await fall(3, 'on', press, 'mended', fps)];
      ok(sameAs(mended[0], was2[0]) && sameAs(mended[1], was2[1]) && mended[0].specials.includes('BOTH_FORCEWALLREBOUND_FORWARD'), `  and under the step-up's mend the same fall at ${fps} frames a second rebounds as it did under the step-up as it was, the climb off and on (${mended.map((m) => `${m.specials.join() || 'none'}, climbs ${m.climbs}`).join('; ')})`);
    }
  }
  const plain = await fall(0, 'on', 0.4);
  ok(plain.airClimb, '  and a body with no Force for the wall moves takes the wall in the air as before (the climb is left only where the Force has its move)');
}

// ---- what is never climbed --------------------------------------------------------------------------------------------------
for (const fps of FPS) {
  restore();
  // An overhang: its face leans out over the body.
  {
    const p = await scene((q) => wedge(q, 105, 5));
    const b = bodyAt(p, 0, 0.6, fps);
    b.key('KeyW', true);
    b.run(fps, 2);
    b.key('KeyW', false);
    ok(b.wall.climbs === 0 && !onWall(b), `${fps} fps: an overhanging face (105°) is never climbed`);
  }
  // A walkable slope (40°, under the climb limit): walked up, never climbed.
  {
    const p = await scene((q) => wedge(q, 40, 3, 2, 30));
    const b = bodyAt(p, 0, 1.0, fps);
    b.key('KeyW', true);
    b.run(fps, 2.5);
    b.key('KeyW', false);
    ok(b.wall.climbs === 0 && b.pos.y > 2.9, `${fps} fps: a walkable 40° slope is walked up (feet at ${n3(b.pos.y)}) and never climbed`);
  }
  // A wall lower than the hands' reach (1.4 m): pressed into, never climbed.
  {
    const p = await scene((q) => box(q, [-3, 0, 2], [3, 1.4, 3]));
    const b = bodyAt(p, 0, 1.0, fps);
    b.key('KeyW', true);
    b.run(fps, 1.5);
    b.key('KeyW', false);
    ok(b.wall.climbs === 0, `${fps} fps: a wall 1.4 m high is never climbed (jumped and grabbed, the ledges')`);
  }
  // A tap of W into a wall (under wallStart pressed into it) and a brush along one at a glance.
  {
    const p = await scene((q) => box(q, [-3, 0, 2], [3, 5, 3]));
    const b = bodyAt(p, 0, 1.6, fps);
    b.key('KeyW', true);
    b.run(fps, 0.15);
    b.key('KeyW', false);
    b.run(fps, 0.5);
    ok(b.wall.climbs === 0, `${fps} fps: a tap of W into a wall does not start the climb`);
    // Along the wall at a glance: forward along +x, the wall at the left shoulder.
    const c = bodyAt(p, -2, 1.62, fps);
    c.forward.set(1, 0, 0.15).normalize();
    c.right.set(0, 0, -1);
    c.key('KeyW', true);
    c.run(fps, 1);
    c.key('KeyW', false);
    ok(c.wall.climbs === 0, `${fps} fps: W held along a wall at a glance never starts the climb`);
  }
}

// ---- the face's own shape: a slab's lean through the hand-over, a stall, a bump, the keys' angle ---------------------------
for (const fps of FPS) {
  restore();
  // A slab leaning back (63°): the figure leant into it on the way up, and that lean eased out through the hang it hands
  // over to (the hang never runs the clocks after it), never held on the hanging figure.
  {
    const p = await scene((q) => wedge(q, 63, 4.7));
    const b = bodyAt(p, 0, 1.0, fps);
    b.key('KeyW', true);
    runUntil(b, fps, 3, () => onWall(b));
    let leanOn = 0;
    const tHang = runUntil(b, fps, 8, () => {
      if (onWall(b)) leanOn = b.wall.lean;
      return b.ledge.holding;
    });
    b.key('KeyW', false);
    const leanAt = b.wall.lean;
    b.run(fps, CLIMB_TUNE.ease + 2 / fps);
    ok(Number.isFinite(tHang) && leanOn > 0.4 && leanAt > 0 && b.wall.lean === 0 && !b.wall.drawn, `${fps} fps: up a 63° slab the figure leans ${n3((leanOn * 180) / Math.PI)}° into it, and the hang the climb hands over to eases that out (${n3((leanAt * 180) / Math.PI)}° at the hand-over, nought ${CLIMB_TUNE.ease} s on)`);
  }
  // A roof standing out over the face 3 m up: the climb stops under it, says so once in words, and hangs on there.
  {
    const p = await scene((q) => {
      box(q, [-3, 0, 2], [3, 6, 3]);
      box(q, [-3, 3.2, 1], [3, 3.5, 2]);
    });
    const b = bodyAt(p, 0, 1.0, fps);
    b.key('KeyW', true);
    runUntil(b, fps, 3, () => onWall(b));
    b.ledgeWords.length = 0;
    b.run(fps, 3);
    b.key('KeyW', false);
    const said = b.ledgeWords.filter((w) => w === 'No way on up here.').length;
    // The standing capsule's top over the feet (its lift off them, two radii and the cylinder's two halves).
    const head = b.pos.y + 0.05 + 2 * (LEDGE_CAPSULE.r + LEDGE_CAPSULE.stand);
    ok(onWall(b) && b.wall.rigState === 'wallStill' && b.wall.stallWhy === 'no room there' && said === 1 && head <= 3.2 && head > 3.2 - 0.1, `${fps} fps: under a roof standing out over the face the climb stops with its capsule's top ${n3(3.2 - head)} m under the roof (3.2), says "No way on up here." once (${said}) and holds on`);
  }
  // A band standing 8 cm proud of the face at 2.5 m: climbed past (held a little further off), never a stall.
  {
    const p = await scene((q) => {
      box(q, [-3, 0, 2], [3, 6, 3]);
      box(q, [-3, 2.4, 1.92], [3, 2.7, 2]);
    });
    const b = bodyAt(p, 0, 1.0, fps);
    b.key('KeyW', true);
    runUntil(b, fps, 3, () => onWall(b));
    b.ledgeWords.length = 0;
    b.run(fps, 3);
    b.key('KeyW', false);
    ok(onWall(b) && b.pos.y > 2.8 && !b.ledgeWords.includes('No way on up here.'), `${fps} fps: a band 8 cm proud of the face is climbed past (feet ${n3(b.pos.y)} m up after 3 s), with no stall`);
  }
}
// A run nudged into a wall at 45 degrees slides along it on the ground and never climbs (the move is cut short, the start's
// test, only where under 0.6 of it is left: the keys within 37 degrees of straight in), while straight in climbs.
for (const fps of FPS) {
  restore();
  const p = await scene((q) => box(q, [-6, 0, 2], [6, 6, 3]));
  const b = bodyAt(p, -4, 1.4, fps);
  b.forward.set(Math.SQRT1_2, 0, Math.SQRT1_2);
  b.right.set(-Math.SQRT1_2, 0, Math.SQRT1_2);
  b.key('KeyW', true);
  b.run(fps, 1.5);
  b.key('KeyW', false);
  ok(b.wall.climbs === 0 && b.pos.x > -2 && b.pos.y < 0.05, `${fps} fps: W at 45 degrees into a wall slides along it on the ground (${n3(b.pos.x + 4)} m along in 1.5 s) and never climbs`);
}
restore();

// ---- on the wall: sideways, down, let go, jump off, stamina ----------------------------------------------------------------
for (const fps of FPS) {
  restore();
  const p = await scene((q) => box(q, [-6, 0, 2], [6, 6, 3]));
  const b = bodyAt(p, 0, 1.0, fps);
  b.key('KeyW', true);
  runUntil(b, fps, 3, () => onWall(b));
  b.run(fps, 1);
  b.key('KeyW', false);
  // Sideways: D to the figure's right (-x as it faces +z), A back.
  const x0 = b.pos.x;
  const y0 = b.pos.y;
  b.key('KeyD', true);
  b.run(fps, 1);
  b.key('KeyD', false);
  ok(Math.abs(b.pos.x - x0 + CLIMB_TUNE.wallSpeed.side) < 0.02 && Math.abs(b.pos.y - y0) < 1e-9 && b.wall.rigState === 'wallRight', `${fps} fps: D climbs sideways ${n3(x0 - b.pos.x)} m to the right in a second (wallSpeed.side), level`);
  b.key('KeyA', true);
  b.run(fps, 0.5);
  b.key('KeyA', false);
  ok(b.pos.x > x0 - CLIMB_TUNE.wallSpeed.side + 0.3 && b.wall.rigState === 'wallLeft', `${fps} fps: A climbs back to the left`);
  b.run(fps, 0.2);
  ok(b.wall.rigState === 'wallStill' && b.wall.rate === 0, `${fps} fps: held still, the clip stops where it is (rate 0)`);
  // Down onto the ground: it stands there.
  b.key('KeyS', true);
  b.run(fps, 0.3);
  ok(b.wall.rigState === 'wallDown' && b.wall.rigClip === WALL_CLIPS.down && Math.abs(b.wall.rate - wallRateOf('wallDown', 1)) < 1e-9, `${fps} fps: S plays the down clip at its own rate (${n3(b.wall.rate)})`);
  const tDown = runUntil(b, fps, 4, () => !onWall(b));
  b.key('KeyS', false);
  ok(Number.isFinite(tDown) && b.wall.lastLetGo === 'stood' && b.grounded && Math.abs(b.pos.y) < 0.02, `${fps} fps: S climbs down (${n3(CLIMB_TUNE.wallSpeed.down)} m/s) and stands on the ground at its foot (feet at ${n3(b.pos.y)})`);
  // Up again, then the crouch lets go and the body falls with no harm from the climb's height.
  b.key('KeyW', true);
  runUntil(b, fps, 3, () => onWall(b));
  b.run(fps, 1.2);
  b.key('KeyW', false);
  const fall0 = b.fallDamage;
  tap(b, 'ControlLeft', fps);
  ok(!onWall(b) && b.wall.lastLetGo === 'let go', `${fps} fps: the crouch key lets go`);
  b.run(fps, 1.5);
  ok(b.grounded && b.fallDamage === fall0, `${fps} fps: and the body falls to the ground unhurt from ${n3(y0 + 1.2)} m`);
  // Space jumps off backward.
  b.key('KeyW', true);
  runUntil(b, fps, 3, () => onWall(b));
  b.run(fps, 0.6);
  b.key('KeyW', false);
  const z0 = b.pos.z;
  tap(b, 'Space', fps);
  ok(!onWall(b) && b.wall.lastLetGo === 'jumped off' && b.vel.z < 0, `${fps} fps: Space jumps off backward (velocity ${n3(b.vel.z)} m/s away from the face)`);
  b.run(fps, 1.5);
  ok(b.pos.z < z0 - 1, `${fps} fps: landing ${n3(z0 - b.pos.z)} m back from the face, turned round once the clip has played (heading ${n3(b.heading)})`);
  // Stamina: climbing drains it at climb.wallStamina.climb, still at .still; empty, the body lets go and says so.
  b.stamina.value = 100;
  b.key('KeyW', true);
  runUntil(b, fps, 3, () => onWall(b));
  b.key('KeyW', false);
  const s0 = b.stamina.value;
  b.run(fps, 1);
  const still = s0 - b.stamina.value;
  ok(Math.abs(still - CLIMB_TUNE.wallStamina.still) < 0.2, `${fps} fps: held still on the wall the pool drains ${n3(still)} a second (climb.wallStamina.still)`);
  b.stamina.value = 100;
  b.key('KeyW', true);
  b.run(fps, 1);
  b.key('KeyW', false);
  const climbed = 100 - b.stamina.value;
  ok(onWall(b) && Math.abs(climbed - CLIMB_TUNE.wallStamina.climb) < 0.3, `${fps} fps: climbing the pool drains ${n3(climbed)} a second (climb.wallStamina.climb)`);
  b.stamina.value = 3;
  b.key('KeyW', true);
  const tTired = runUntil(b, fps, 2, () => !onWall(b));
  b.key('KeyW', false);
  ok(Number.isFinite(tTired) && b.wall.lastLetGo === 'tired' && b.ledgeWords.includes('Too tired to hold on.'), `${fps} fps: an empty pool lets go (${n3(tTired)} s from 3 points at ${CLIMB_TUNE.wallStamina.climb} a second) and says so`);
  b.run(fps, 1.5);
  b.key('KeyW', true);
  b.run(fps, 1);
  b.key('KeyW', false);
  ok(!onWall(b), `${fps} fps: tired, pressing into the wall does not start a climb`);
}

// ---- nothing cast walking free, nothing climbed under 'before' -------------------------------------------------------------
{
  restore();
  const p = await scene(() => {});
  const b = bodyAt(p, 0, 0, 60);
  b.key('KeyW', true);
  b.run(60, 2);
  b.key('KeyW', false);
  ok(b.wall.casts === 0, 'walking free in the open, the climb asks the engine nothing (no ray while the move is not cut short)');
  CLIMB_TUNE.wall = 'before';
  const q = await scene((r) => box(r, [-3, 0, 2], [3, 5, 3]));
  const c = bodyAt(q, 0, 1.0, 60);
  c.key('KeyW', true);
  c.run(60, 3);
  c.key('KeyW', false);
  ok(c.wall.climbs === 0 && c.wall.casts === 0, "under climb.wall 'before' nothing is felt for or climbed");
  restore();
}
ok(LOCO_TUNE.slope.climb === 55, 'the slope limit the climb reads is wave 2b\'s, untouched (55°)');
void LEDGE_HANG;
console.log(`wallClimb: ${checks} checks passed`);
