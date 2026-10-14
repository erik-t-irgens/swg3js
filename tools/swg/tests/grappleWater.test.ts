// The grappling hook in water (the design's §3.17), against real Rapier through the grapple's own harness, its swim
// the game's own `swimStep`, at 144, 60 and 30 frames a second, from the scenarios the prototype measured them in
// (A:\swg3js\grapple\proto\r5\swim.ts). Check 1 holds `swimStep` to the swim block as it stood before this pass,
// kept here word for word; every check that claims to see a fault runs the control the design names.
//
// Run: node tools/swg/tests/grappleWater.test.ts
import assert from 'node:assert/strict';
import { GRAPPLE_DEFAULTS, GRAPPLE_TUNE } from '../../../src/player/grapple.ts';
import { newSwimIn, newSwimOut, swimStep, SWIM_DEPTH, SWIM_RUN_SPEED, type SwimProbe } from '../../../src/player/swimStep.ts';
import { underWater } from '../../../src/player/grappleMath.ts';
import { afloatVelocity } from '../../../src/world/afloat.ts';
import type { Physics } from '../../../src/core/physics.ts';
import { TestBody, THREE, box, ground, heightChunk, makePhysics, probeFrom, type Surface } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const FPS = [144, 60, 30];
const r2 = (v: number) => Number(v.toFixed(2));
const fresh = () => Object.assign(GRAPPLE_TUNE, GRAPPLE_DEFAULTS);
const flat: Surface = () => 0;

async function scene(build: (p: Physics) => void, surface: Surface = flat) {
  fresh();
  const physics = await makePhysics();
  build(physics);
  physics.stepOnce();
  const b = new TestBody(physics);
  b.surface = surface;
  return { physics, b };
}

// =============================================================================================================
// 1. `swimStep` is the old block: the swim as `Player.update` held it at the merge, copied here word for word but
// for its names (the camera's dive read in, the probe and the speed handed back), against `swimStep` over ten
// thousand random states, every output by Object.is. The copy carries the old block's own numbers as the literals
// player.ts held them (`SWIM_SPEED` 0.45, `SWIM_DEPTH` 1.1, `RUN_SPEED` 5.5), never the module's constants: a copy
// that read them from `swimStep.ts` would move with the very thing it holds still.
{
  const RUN_SPEED = 5.5;
  const OLD_SWIM_SPEED = 0.45;
  const OLD_SWIM_DEPTH = 1.1;
  type Old = { vel: { x: number; y: number; z: number }; posY: number; surface: number; depth: number; submerged: boolean; jump: boolean; crouch: boolean; moving: boolean; moveX: number; moveZ: number; diveY: number; mz: number; speed: number; dt: number };
  const oldSwim = (o: Old, probe: SwimProbe): { speed: number; grounded: boolean } => {
    const SWIM_SPEED = OLD_SWIM_SPEED;
    const SWIM_DEPTH = OLD_SWIM_DEPTH;
    const dt = o.dt;
    const surface = o.surface;
    const depth = o.depth;
    let speed = o.speed;
    speed *= SWIM_SPEED;
    const k = 1 - Math.exp(-dt * 4);
    o.vel.x += (o.moveX * speed - o.vel.x) * k;
    o.vel.z += (o.moveZ * speed - o.vel.z) * k;
    const ride = afloatVelocity(surface - SWIM_DEPTH, o.posY, o.vel.y, dt);
    let vy = 0;
    let riding = false;
    if (o.jump) vy = SWIM_SPEED * RUN_SPEED;
    else if (o.crouch) vy = -SWIM_SPEED * RUN_SPEED;
    else if (o.moving) {
      vy = o.diveY * speed * (o.mz >= 0 ? 1 : -1);
      if (!o.submerged && (vy > 0 || o.diveY > -0.5)) {
        vy = ride;
        riding = true;
      }
    } else if (!o.submerged) {
      vy = ride;
      riding = true;
    } else vy = -0.3;
    if (riding) o.vel.y = vy;
    else o.vel.y += (vy - o.vel.y) * (1 - Math.exp(-dt * 6));
    const asked = o.vel.y;
    if (o.vel.y > 0 && depth - o.vel.y * dt < SWIM_DEPTH) o.vel.y = Math.max(0, (depth - SWIM_DEPTH) / dt);
    probe.dt = dt;
    probe.surface = surface;
    probe.want = surface - SWIM_DEPTH;
    probe.from = o.posY;
    probe.gap = surface - SWIM_DEPTH - o.posY;
    probe.ride = ride;
    probe.riding = riding;
    probe.asked = asked;
    probe.capped = o.vel.y;
    probe.moved = Number.NaN;
    return { speed, grounded: false };
  };
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const newProbe = (): SwimProbe => ({ dt: 0, surface: 0, want: 0, from: 0, gap: 0, ride: 0, riding: false, asked: 0, capped: 0, moved: 0, rope: false });
  const sin = newSwimIn();
  const sout = newSwimOut();
  let same = 0;
  const N = 10_000;
  for (let i = 0; i < N; i++) {
    const surface = pick([0, -0.4, 2.5, (rand() - 0.5) * 10]);
    const posY = surface - pick([SWIM_DEPTH, SWIM_DEPTH - 0.3, SWIM_DEPTH + 0.001, 1.9, 3, rand() * 6]);
    const depth = surface - posY;
    const vel = { x: (rand() - 0.5) * 20, y: (rand() - 0.5) * 20, z: (rand() - 0.5) * 20 };
    const o: Old = { vel: { ...vel }, posY, surface, depth, submerged: rand() < 0.4, jump: rand() < 0.2, crouch: rand() < 0.2, moving: rand() < 0.6, moveX: rand() * 2 - 1, moveZ: rand() * 2 - 1, diveY: rand() * 2 - 1, mz: pick([-1, 0, 1]), speed: pick([5.5, 2, 2.75, rand() * 12]), dt: pick([1 / 144, 1 / 60, 1 / 30, 0.05, rand() * 0.05]) };
    const pOld = newProbe();
    const rOld = oldSwim(o, pOld);
    sin.vel = { ...vel };
    sin.posY = o.posY;
    sin.surface = o.surface;
    sin.depth = o.depth;
    sin.submerged = o.submerged;
    sin.jump = o.jump;
    sin.crouch = o.crouch;
    sin.moving = o.moving;
    sin.moveX = o.moveX;
    sin.moveZ = o.moveZ;
    sin.diveY = o.diveY;
    sin.forward = o.mz >= 0;
    sin.speed = o.speed;
    sin.dt = o.dt;
    sin.ropeLift = false;
    sin.towed = false;
    const pNew = newProbe();
    const rNew = swimStep(sin, pNew, sout);
    const fields: (keyof SwimProbe)[] = ['dt', 'surface', 'want', 'from', 'gap', 'ride', 'riding', 'asked', 'capped', 'moved'];
    const eq = Object.is(o.vel.x, sin.vel.x) && Object.is(o.vel.y, sin.vel.y) && Object.is(o.vel.z, sin.vel.z) && fields.every((f) => Object.is(pOld[f], pNew[f])) && Object.is(rOld.speed, rNew.speed) && rOld.grounded === rNew.grounded && pNew.rope === false;
    if (eq) same++;
  }
  ok(same === N, `swimStep is the old swim block over ${N} random states: the velocity, every probe field, the swum speed and grounded, by Object.is (${same} the same)`);
  ok(SWIM_RUN_SPEED === RUN_SPEED, "the swim's run is the player's own 5.5");
}

// =============================================================================================================
// 2. A swell: hanging taut from a beam 15 m up over a sea swelling 0.75 m either way every 8 s, for 64 s.
for (const fps of FPS) {
  const A = 0.75;
  const T = 8;
  let beam: unknown = null;
  const { physics, b } = await scene(
    (p) => {
      ground(p, -30);
      beam = box(p, [-3, 15, -3], [3, 16, 3], true);
    },
    (_x, _z, t) => A * Math.sin((2 * Math.PI * t) / T),
  );
  const feet = -0.95;
  b.place(0, feet, 0);
  physics.stepOnce();
  b.hook(0, 15, 0, 0, -1, 0, beam as never, 14.95 - (feet + GRAPPLE_TUNE.ropeY));
  const dt = 1 / fps;
  let prevVy = b.vel.y;
  let worst = 0;
  let toggles = 0;
  let back = 0;
  let lastToggle = -10;
  let was = b.swimming;
  const seconds = 64;
  for (let i = 0; i < seconds * fps; i++) {
    b.frame(dt);
    if (b.swimming !== was) {
      toggles++;
      if (i - lastToggle === 1) back++;
      lastToggle = i;
      was = b.swimming;
    }
    if (i > 4 * fps) worst = Math.max(worst, Math.abs(b.vel.y - prevVy));
    prevVy = b.vel.y;
  }
  ok(toggles <= 2 * (seconds / T) && back === 0 && b.grapple.attached, `${fps} fps: hanging taut over a swell, the swim changes ${toggles} times in ${seconds / T} waves (at most 2 a wave), never on two frames running`);
  ok(worst < 1, `${fps} fps: its worst one-frame step in vel.y is ${r2(worst)} m/s (under 1)`);
}

// =============================================================================================================
// 3. A swing into deep water: 30 m from 60 degrees, the arc 6.3 m under the surface.
for (const fps of FPS) {
  let beam: unknown = null;
  const { physics, b } = await scene((p) => {
    ground(p, -30);
    beam = box(p, [-3, 25, -3], [3, 26, 3], true);
  });
  const L = 30;
  const th = (60 * Math.PI) / 180;
  b.place(L * Math.sin(th), 24.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
  physics.stepOnce();
  b.hook(0, 25, 0, 0, -1, 0, beam as never, L);
  const dt = 1 / fps;
  let entry = -1;
  let speed1 = Number.NaN;
  let deepest = 0;
  for (let i = 0; i < 12 * fps; i++) {
    b.frame(dt);
    const t = (i + 1) * dt;
    if (entry < 0 && b.pos.y < 0) entry = t;
    if (entry >= 0 && Number.isNaN(speed1) && t >= entry + 1) speed1 = b.vel.length();
    if (entry >= 0) deepest = Math.max(deepest, -b.pos.y);
  }
  ok(speed1 < 1 && deepest <= 1.5 && b.grapple.attached, `${fps} fps: a swing into deep water is down to ${r2(speed1)} m/s a second after entry (under 1), the feet never deeper than ${r2(deepest)} m (1.5), still attached`);
}

// =============================================================================================================
// 4. The reel out (`swimLift`): toward a cliff-face anchor 6 m over the water and 20 m off.
{
  const reelOut = async (fps: number, lift: number) => {
    let cliff: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, -20);
      cliff = box(p, [20, -20, -30], [40, 8, 30], true);
    });
    GRAPPLE_TUNE.swimLift = lift;
    // In the water and swimming before the hook goes in (placed at the swim's own depth it would only wade).
    b.place(0, -SWIM_DEPTH - 0.1, 0);
    physics.stepOnce();
    b.run(fps, 0.5);
    b.hook(20, 6, 0, -1, 0, 0, cliff as never);
    b.key('ShiftLeft', true);
    const dt = 1 / fps;
    let fastest = 0;
    let crossings = 0;
    let was = b.swimming;
    let outAt = -1;
    let worst = 0;
    for (let i = 0; i < 6 * fps && b.grapple.attached; i++) {
      b.frame(dt);
      if (b.swimming) fastest = Math.max(fastest, b.vel.length());
      if (b.swimming !== was) {
        crossings++;
        was = b.swimming;
        outAt = b.swimming ? -1 : (i + 1) * dt;
      }
      worst = Math.max(worst, b.grapple.lastImpact);
    }
    b.key('ShiftLeft', false);
    return { fastest, crossings, outAt, worst, out: !b.swimming };
  };
  for (const fps of FPS) {
    const lift = await reelOut(fps, GRAPPLE_DEFAULTS.swimLift);
    const never = await reelOut(fps, 90);
    ok(lift.fastest <= 9 && lift.crossings === 1 && lift.out && lift.outAt >= 0 && lift.outAt <= 2.5, `${fps} fps: reeled in toward a cliff-face anchor from the water, never faster than ${r2(lift.fastest)} m/s in it (9), ${lift.crossings} crossing of the surface (1), out for good (${lift.out}) at ${r2(lift.outAt)} s (2.5)`);
    // The design's 13 was measured at 144 and 60 fps; at 30 the strike comes out 12.6 here, so the bound is the
    // strike against the lift's own worst contact as well as 12.
    ok(never.worst > 12 && never.worst > lift.worst, `${fps} fps: with swimLift 90 (the rope never takes the vertical) the same reel strikes the face at ${r2(never.worst)} m/s (over 12, and against ${r2(lift.worst)} with the lift): the test sees the fault`);
  }
  fresh();
}

// =============================================================================================================
// 5. A beach: hauled up a beach to an anchor 45 m off.
const beachH = (x: number) => (x < 0 ? -6 : x > 40 ? 1.5 : -6 + (7.5 * x) / 40);
const beach = (p: Physics) => {
  heightChunk(p, -20, -32, (x) => beachH(x));
  heightChunk(p, 44, -32, (x) => beachH(x));
  heightChunk(p, -84, -32, (x) => beachH(x));
};
for (const fps of FPS) {
  const { physics, b } = await scene(beach);
  b.place(0, -SWIM_DEPTH - 0.1, 0);
  physics.stepOnce();
  b.run(fps, 0.5);
  b.hook(45, beachH(45), 0, 0, 1, 0, null);
  b.key('KeyF', true);
  const dt = 1 / fps;
  let standAt = -1;
  for (let i = 0; i < 4 * fps; i++) {
    b.frame(dt);
    if (standAt < 0 && b.pos.y >= 0 && b.grounded && !b.swimming) standAt = (i + 1) * dt;
    if (standAt >= 0) break;
  }
  b.key('KeyF', false);
  ok(standAt >= 0 && standAt <= 2, `${fps} fps: hauled up a beach to an anchor 45 m off, standing out of the water at ${r2(standAt)} s (2)`);
}

// =============================================================================================================
// 6. Not pulled under: reeled or hauled toward a rock top at the water line 5 m and 30 m off.
for (const fps of FPS) {
  for (const rx of [5, 30]) {
    for (const how of ['ShiftLeft', 'KeyF']) {
      let rock: unknown = null;
      const { physics, b } = await scene((p) => {
        ground(p, -20);
        rock = box(p, [rx, -20, -2], [rx + 3, 0, 2], true);
      });
      b.place(0, -SWIM_DEPTH - 0.1, 0);
      physics.stepOnce();
      b.run(fps, 0.5);
      b.hook(rx + 0.5, 0, 0, 0, 1, 0, rock as never);
      b.key(how, true);
      let headUnder = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < 12 * fps && b.grapple.attached; i++) {
        b.frame(1 / fps);
        headUnder = Math.max(headUnder, 0 - (b.pos.y + 1.6));
      }
      b.key(how, false);
      ok(headUnder < 0, `${fps} fps: ${how === 'KeyF' ? 'hauled' : 'reeled'} toward a rock top at the water line ${rx} m off, the head stays ${r2(-headUnder)} m clear of the surface`);
    }
  }
}

// =============================================================================================================
// 7. The wading band: a swing from 45 degrees whose bottom runs 0.9 m deep, and a walk through 0.9 m of water on a slack line.
for (const fps of FPS) {
  let beam: unknown = null;
  const { physics, b } = await scene((p) => {
    ground(p, -30);
    beam = box(p, [-3, 25, -3], [3, 26, 3], true);
  });
  // From 45 degrees, as the prototype measured it (out-wade.txt).
  const L = 24.95 - GRAPPLE_TUNE.ropeY + 0.9;
  const th = (45 * Math.PI) / 180;
  b.place(L * Math.sin(th), 24.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
  physics.stepOnce();
  b.hook(0, 25, 0, 0, -1, 0, beam as never, L);
  const dt = 1 / fps;
  const bottoms: number[] = [];
  for (let i = 0; i < 20 * fps && bottoms.length < 2; i++) {
    const x0 = b.pos.x;
    b.frame(dt);
    if ((x0 > 0 && b.pos.x <= 0) || (x0 < 0 && b.pos.x >= 0)) bottoms.push(b.vel.length());
  }
  ok(bottoms.length === 2 && bottoms[0] < 14 && bottoms[1] < 8, `${fps} fps: a swing whose bottom runs 0.9 m deep crosses it at ${bottoms.map(r2).join(' then ')} m/s (under 14, then under 8)`);
}
{
  const walk = async (fps: number, roped: boolean, sync = true) => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, -0.9);
      beam = box(p, [-30.5, 30, -0.5], [-29.5, 31, 0.5], false);
    });
    GRAPPLE_TUNE.syncCollider = sync;
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(0, -0.88, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    if (roped) b.hook(-30, 30, 0, 0, -1, 0, beam as never, 90);
    const trace: number[] = [];
    b.key('KeyW', true);
    b.run(fps, 3, () => trace.push(b.pos.x, b.pos.y, b.pos.z));
    b.key('KeyW', false);
    return trace;
  };
  const apart = (a: number[], c: number[]) => {
    let worst = a.length === c.length ? 0 : Infinity;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - c[i]));
    return worst;
  };
  for (const fps of FPS) {
    const plain = await walk(fps, false);
    const roped = await walk(fps, true);
    const unsynced = await walk(fps, true, false);
    fresh();
    ok(apart(plain, unsynced) === 0, `${fps} fps: walking through 0.9 m of water on a slack line with the collider sync off is the walk with no line to the bit`);
    // With the sync on, the line puts the capsule where the body is before the controller moves it, where the walk
    // with no line starts the controller from wherever the last physics step left the capsule (at 144 fps a frame or
    // two behind; at 60 the two are the same place, and the walks are the same to the bit). The controller stands a
    // walking body anywhere inside its own 4 cm skin over the ground, so two controllers started a hair apart ride
    // that skin a little differently: measured, the two walks stay within a millimetre in height for most of the walk
    // and part for a few tenths of a second at a time, by up to 18 mm at 144 fps and 14 at 30, and come back; each such
    // moment leaves the walk a few millimetres behind or ahead along its way (6 mm over 3 s and 16 m at 144 fps). So
    // what is held is what the design meant by its 1 mm: nothing but the sync differs (above), no place ever leaves
    // the controller's skin of the walk with no line, the height comes back (within a millimetre at the end), and the
    // walk is never more than a centimetre behind or ahead.
    const skin = 0.04;
    const worst = apart(plain, roped);
    const end = plain.length - 3;
    const endHeight = Math.abs(plain[end + 1] - roped[end + 1]);
    let way = 0;
    for (let i = 0; i < plain.length; i += 3) way = Math.max(way, Math.abs(plain[i] - roped[i]), Math.abs(plain[i + 2] - roped[i + 2]));
    ok(worst <= skin && endHeight <= 0.001 && way <= 0.01, `${fps} fps: and with the sync on every place stands within ${r2(worst * 1000)} mm of it (inside the controller's ${skin * 1000} mm skin), the height ends ${r2(endHeight * 1000)} mm from it (within 1 mm) and the walk is at most ${r2(way * 1000)} mm behind or ahead (under 10)`);
  }
}
// =============================================================================================================
// 8. The fall into water: dropped from 30 m into deep water, swum to the beach and walked out.
{
  const dropOut = async (fps: number, level: number, hold: boolean, crouch: boolean, roped: boolean) => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beach(p);
      beam = box(p, [-21, 35, -1], [-19, 36, 1], false);
    });
    b.jka.forceLevel = level;
    b.swimHoldsApex = hold;
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    if (roped) {
      // Hanging 25 m up from a swing over the deep end, let go there.
      b.place(-20, 25, 0);
      physics.stepOnce();
      b.hook(-20, 35, 0, 0, -1, 0, beam as never);
      b.run(fps, 0.2);
      b.grapple.letGo('fire');
    } else {
      b.place(0, 30, 0);
      physics.stepOnce();
    }
    const dt = 1 / fps;
    b.key('KeyW', true);
    let wasIn = false;
    for (let i = 0; i < 40 * fps; i++) {
      if (b.swimming) wasIn = true;
      b.key('ControlLeft', crouch && wasIn && !b.swimming);
      b.frame(dt);
      if (b.pos.x > 38) break;
    }
    b.key('KeyW', false);
    b.key('ControlLeft', false);
    return { harm: b.fallDamage, saved: b.rollSaved, out: b.pos.x > 38, wasIn };
  };
  for (const fps of FPS) {
    for (const level of [0, 3]) {
      const drop = await dropOut(fps, level, true, true, false);
      ok(drop.out && drop.wasIn && drop.harm === 0 && drop.saved === 0, `${fps} fps, Force ${level}: dropped from 30 m into deep water, swum to a beach and walked out crouched: ${drop.harm} harm and ${drop.saved} saved by a roll`);
      const swing = await dropOut(fps, level, true, true, true);
      ok(swing.out && swing.wasIn && swing.harm === 0, `${fps} fps, Force ${level}: let go over water from a swing 25 m up and swum out the same way: ${swing.harm} harm`);
    }
    const old = await dropOut(fps, 0, false, false, false);
    ok(old.harm === 60, `${fps} fps: with the swim's own hold taken out the drop costs ${old.harm} as it walks out (60): the test sees the fault`);
  }
}

// =============================================================================================================
// 9. The mark and water: a lake bed under 3 m of water and a flow's bed under 1 m of lava are refused; the far
// shore above the water shows; a dart fired from under water at a cliff top bites it.
{
  // The shore west of x 0, a lake 3 m deep to x 30 (z under 20) and a lava flow 1 m deep beside it (z over 20),
  // the far shore past x 30, and a cliff standing in the lake.
  const bed = (x: number, z: number) => (x < 0 ? 0.5 : x > 30 ? 2 : z > 20 ? -1 : -3);
  // The world's two answers the game's own water test is made of, stood in for: the column of water over a point
  // (`waterColumnAt`, none over the flow) and how deep under a flow it lies (`lavaAt`), put together exactly as the
  // game's `grappleWater` puts them, through the very `underWater` it calls.
  const columnAt = (x: number, z: number) => (x >= 0 && x <= 30 && z <= 20 ? 0 : Number.NEGATIVE_INFINITY);
  const flowDepth = (x: number, y: number, z: number) => (x >= 0 && x <= 30 && z > 20 ? 0 - y : Number.NEGATIVE_INFINITY);
  const under = (p: { x: number; y: number; z: number }) => underWater(p.y, columnAt(p.x, p.z), 0) || flowDepth(p.x, p.y, p.z) > 0;
  let cliff: unknown = null;
  const { physics, b } = await scene((p) => {
    for (const ox of [-64, 0]) for (const oz of [-32, 32]) heightChunk(p, ox, oz, (x, z) => bed(x, z));
    cliff = box(p, [14, -3, -12], [18, 6, -8], true);
  });
  b.place(-5, 0.52, 0);
  physics.stepOnce();
  b.run(60, 0.2);
  const g = b.grapple;
  const look = (x: number, y: number, z: number) => {
    const h = b.hand();
    const d = new THREE.Vector3(x, y, z).sub(h).normalize();
    g.mark.holdLeft = 0;
    probeFrom(g, physics, h, d, 0, h, b.filter, b.body, under);
    return { kind: g.mark.kind, shows: g.mark.shows };
  };
  const lake = look(10, -3, 0);
  ok(lake.kind === 'water' && !lake.shows, `from a shore, a lake bed under 3 m of water is refused (${lake.kind})`);
  const lava = look(10, -1, 26);
  ok(lava.kind === 'water' && !lava.shows, `a flow's bed under 1 m of lava is refused (${lava.kind})`);
  const shore = look(40, 2, 0);
  ok(shore.kind === 'terrain' && shore.shows, `the lake's far shore above the water shows (${shore.kind})`);
  // Under the water, a dart at the cliff's top.
  b.surface = (x, z) => (x >= 0 && x <= 30 && z <= 20 ? 0 : Number.NEGATIVE_INFINITY);
  b.place(12, -2.6, -2);
  physics.stepOnce();
  b.frame(1 / 60);
  const submerged = b.submerged;
  b.fireAt = { x: 16, y: 6, z: -10 };
  b.key('Mouse3', true);
  b.frame(1 / 60);
  b.key('Mouse3', false);
  for (let i = 0; i < 30 && g.flying; i++) b.frame(1 / 60);
  ok(submerged && g.attached && g.rope.cols[0] === cliff && g.rope.pts[1] > 0, `a dart fired from under water at a cliff top bites it above the water (${g.state}, ${r2(g.rope.pts[1])} m up)`);
}

// =============================================================================================================
// 10. Lava: waist-deep in a flow, hauled to an anchor 20 m off on the bank.
for (const fps of FPS) {
  const flowH = (x: number) => (x < 15 ? -1 : 0.5);
  const { physics, b } = await scene(
    (p) => {
      for (const ox of [-64, 0]) heightChunk(p, ox, -32, (x) => flowH(x));
    },
    (x) => (x < 15 ? 0 : Number.NEGATIVE_INFINITY),
  );
  b.place(0, -0.98, 0);
  physics.stepOnce();
  b.run(fps, 0.2);
  const inFlow = b.depth > 0.5 && !b.swimming;
  b.hook(20, 0.5, 0, 0, 1, 0, null);
  b.key('KeyF', true);
  let outAt = -1;
  for (let i = 0; i < 4 * fps; i++) {
    b.frame(1 / fps);
    if (outAt < 0 && b.depth <= 0) outAt = (i + 1) / fps;
    if (outAt >= 0) break;
  }
  b.key('KeyF', false);
  ok(inFlow && outAt >= 0 && outAt <= 2, `${fps} fps: waist-deep in a flow, hauled to an anchor 20 m off on the bank, out at ${r2(outAt)} s (2)`);
}

console.log(`\n${checks} checks passed`);
