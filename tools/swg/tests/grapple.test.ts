// The grappling hook against real Rapier: the player's own capsule, controller, movement and swim, stepped in the
// player's own order by `grappleBody.ts`, calling the very grapple steps and key block the game calls. Each check
// that moves a body runs at 144, 60 and 30 frames a second, as the prototype that measured the design's numbers
// did (A:\swg3js\grapple\proto). Every check that claims to see a fault runs the control case the design names
// (the sync off, the fan off, the chord sweep, the haul's arrival off), so a test that sees nothing cannot pass.
//
// Test 27 reads a real world's terrain out of the packs (SWG3JS_PACKS, else assets-private) and checks nothing
// without them. Test 17 measures allocation and needs `node --expose-gc`; without it it says so and passes
// nothing (its hold on the hook's own code runs `grappleAllocOwn.ts` in a node process of its own and reads the line
// it prints). Nothing else is read from the game's files. `GRAPPLE_ONLY=5,6` runs only those sections.
//
// Run: node --expose-gc tools/swg/tests/grapple.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { GRAPPLE_DEFAULTS, GRAPPLE_GRAVITY, GRAPPLE_TUNE, newFireState, tuneGrapple } from '../../../src/player/grapple.ts';
import { GrappleRope, bendOffsetDir } from '../../../src/player/grappleRope.ts';
import { grappleMutes, joltFor, leanRate, slamHarm } from '../../../src/player/grappleMath.ts';
import { GRAPPLE_SOUND, GRAPPLE_SOUND_IDS, GrappleSounds } from '../../../src/audio/grappleSounds.ts';
import { RopeRibbon } from '../../../src/player/grappleDraw.ts';
import { Group, groups, isEngineFault, RAPIER, type Physics } from '../../../src/core/physics.ts';
import { CAPSULE_RADIUS, CROUCH_HALF_HEIGHT, TestBody, THREE, box, ground, heightChunk, makePhysics, probeFrom, trunk } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
const FPS = [144, 60, 30];
const r2 = (v: number) => Number(v.toFixed(2));
const r3 = (v: number) => Number(v.toFixed(3));
const G = GRAPPLE_GRAVITY;
const ONLY = (process.env.GRAPPLE_ONLY ?? '')
  .split(',')
  .filter(Boolean)
  .map(Number);
async function section(n: number, title: string, fn: () => Promise<void> | void): Promise<void> {
  if (ONLY.length && !ONLY.includes(n)) return;
  console.log(`-- ${n}. ${title}`);
  await fn();
}

/** Every tune key back as it ships, between scenarios. */
const fresh = () => Object.assign(GRAPPLE_TUNE, GRAPPLE_DEFAULTS);

/** A body in a fresh world, the world built by `build`, stepped once so queries see it. */
async function scene(build: (p: Physics) => void = () => {}) {
  fresh();
  const physics = await makePhysics();
  build(physics);
  physics.stepOnce();
  const b = new TestBody(physics);
  return { physics, b };
}

/** Press a key (or a mouse button) for one frame. */
function tap(b: TestBody, code: string, dt: number): void {
  b.key(code, true);
  b.frame(dt);
  b.key(code, false);
}

/** The hand's distance from the free span's pivot. */
const pv = new THREE.Vector3();
function handToPivot(b: TestBody): number {
  b.pivot(pv);
  return Math.hypot(b.pos.x - pv.x, b.pos.y + GRAPPLE_TUNE.ropeY - pv.y, b.pos.z - pv.z);
}

/** §4.11's shape (test 29, checked inside tests 2, 5, 6 and 7): every point on frame 0, and the still family alone. */
function shapeOk(r: GrappleRope): boolean {
  for (let i = 0; i <= r.n; i++) if (r.pf[i] !== 0) return false;
  return r.families.length === 1 && r.families[0].frame === 0;
}

/** The side worked out again from each bend's hinge against the side it was made with, the worst component. */
const sideV = { x: 0, y: 0, z: 0 };
function sideErr(r: GrappleRope): number {
  let worst = 0;
  for (let j = 1; j <= r.n; j++) {
    if (!r.sideNow(j, sideV)) continue;
    worst = Math.max(worst, Math.abs(sideV.x - r.sideMade[3 * j]), Math.abs(sideV.y - r.sideMade[3 * j + 1]), Math.abs(sideV.z - r.sideMade[3 * j + 2]));
  }
  return worst;
}

/** Distance from a point to the line through a along unit u. */
function toLine(px: number, py: number, pz: number, ax: number, ay: number, az: number, ux: number, uy: number, uz: number): number {
  const dx = px - ax;
  const dy = py - ay;
  const dz = pz - az;
  const d = dx * ux + dy * uy + dz * uz;
  return Math.hypot(dx - ux * d, dy - uy * d, dz - uz * d);
}

// =============================================================================================================
await section(1, 'day one', async () => {
  const run = async (fps: number, hooks: boolean) => {
    const { physics, b } = await scene((p) => {
      const h = (x: number) => (x >= -30 ? 0 : x <= -34 ? -5 : (-5 * (-30 - x)) / 4);
      for (const ox of [-128, -64, 0, 64]) for (const oz of [-64, 0]) heightChunk(p, ox, oz, (x) => h(x));
      box(p, [10, 0, -5], [20, 8, 5]);
    });
    b.hooks = hooks;
    b.jka.forceLevel = 0;
    b.surface = (x) => (x < -31 ? -0.5 : Number.NEGATIVE_INFINITY);
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(0, 0.05, 0);
    physics.stepOnce();
    const trace: number[] = [];
    const dt = 1 / fps;
    const n = Math.round(20 * fps);
    let placed1 = false;
    let placed2 = false;
    let placed3 = false;
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      if (t >= 4 && !placed1) {
        placed1 = true;
        b.forward.set(-1, 0, 0);
        b.right.set(0, 0, -1);
        b.place(15, 8.05, 0);
      }
      if (t >= 6.5 && !placed2) {
        placed2 = true;
        b.place(15, 8.05, 0);
      }
      if (t >= 10 && !placed3) {
        placed3 = true;
        b.place(-20, 0.05, 0);
      }
      b.key('KeyW', t < 3 || (t >= 4 && t < 14));
      b.key('ShiftLeft', t < 1.5);
      b.key('Space', t >= 3 && t < 3.1);
      b.key('ControlLeft', t >= 7.4 && t < 9.5);
      b.frame(dt);
      trace.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.fallDamage);
    }
    return { trace, b };
  };
  for (const fps of FPS) {
    const a = await run(fps, true);
    const z = await run(fps, false);
    let same = a.trace.length === z.trace.length;
    for (let i = 0; same && i < a.trace.length; i++) if (!Object.is(a.trace[i], z.trace[i])) same = false;
    ok(a.b.jumped > 0 && a.b.fallDamage > 0 && a.b.rolled && a.b.rollSaved > 0 && a.b.swimToggles > 0, `${fps} fps: the day walks, runs, jumps, falls ${a.b.fallDamage} harm from 8 m, rolls a landing (${a.b.rollSaved} saved) and swims`);
    ok(same, `${fps} fps: with the hook's steps called (never fired) and not called, every place, velocity and fall's harm is the same by Object.is over 20 s (${a.trace.length / 7} frames)`);
  }
});

// =============================================================================================================
// 2, 3. The pendulum and the reel (the constraint on its own, in open air: no drag, so the energy is the constraint's).
await section(2, 'the pendulum and the reel', async () => {
  const L = 20;
  const AY = 60;
  const exactPeriod = (th: number) => {
    const k = Math.sin(th / 2);
    let K = 0;
    const N = 20000;
    for (let j = 0; j < N; j++) K += 1 / Math.sqrt(1 - k * k * Math.sin(((j + 0.5) / N) * (Math.PI / 2)) ** 2);
    K *= Math.PI / 2 / N;
    return 4 * Math.sqrt(L / G) * K;
  };
  for (const fps of FPS) {
    let top: unknown = null;
    const { b } = await scene((p) => (top = box(p, [-0.5, AY, -0.5], [0.5, AY + 1, 0.5], false)));
    GRAPPLE_TUNE.swingDrag = 0;
    const th = (60 * Math.PI) / 180;
    const ay = AY - 0.05;
    b.place(L * Math.sin(th), ay - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
    b.physics.stepOnce();
    b.hook(0, AY, 0, 0, -1, 0, top as never, L);
    const energy = () => 0.5 * b.vel.lengthSq() + G * (b.pos.y + GRAPPLE_TUNE.ropeY);
    const e0 = energy();
    const crossings: number[] = [];
    let lastX = b.pos.x;
    let maxDev = 0;
    let shape = true;
    b.run(fps, 20, (t) => {
      const dx = b.pos.x;
      const dy = b.pos.y + GRAPPLE_TUNE.ropeY - ay;
      maxDev = Math.max(maxDev, Math.abs(Math.hypot(dx, dy, b.pos.z) - L));
      if (lastX < 0 && b.pos.x >= 0) crossings.push(t);
      lastX = b.pos.x;
      shape &&= shapeOk(b.grapple.rope);
    });
    const periods = crossings.slice(1).map((c, k) => c - crossings[k]);
    const period = periods.reduce((a, c) => a + c, 0) / periods.length;
    const kept = (100 * (energy() - G * (ay - L))) / (e0 - G * (ay - L));
    const exact = exactPeriod(th);
    ok(kept > 99.5 && kept < 100.5, `${fps} fps: a 20 m pendulum from 60 degrees keeps ${r2(kept)} % of its energy over 20 s`);
    ok(Math.abs(period - exact) / exact < 0.002, `${fps} fps: its period ${r3(period)} s is within 0.2 % of the exact ${r3(exact)} s`);
    ok(maxDev < 0.02, `${fps} fps: and it never stands more than 2 cm off its length (${r3(maxDev)} m)`);
    ok(b.grapple.modes.hanging && b.grapple.rope.n === 0 && shape, `${fps} fps: hanging the whole time, nothing to bend round, every point on frame 0 and the still family alone`);
  }
  for (const fps of FPS) {
    let top: unknown = null;
    const { b } = await scene((p) => (top = box(p, [-0.5, AY, -0.5], [0.5, AY + 1, 0.5], false)));
    GRAPPLE_TUNE.swingDrag = 0;
    GRAPPLE_TUNE.reel = 25;
    const ay = AY - 0.05;
    b.place(0, ay - L - GRAPPLE_TUNE.ropeY, 0);
    b.physics.stepOnce();
    b.hook(0, AY, 0, 0, -1, 0, top as never, L);
    b.vel.set(15, 0, 0);
    const ang = () => Math.abs(b.pos.x * b.vel.y - (b.pos.y + GRAPPLE_TUNE.ropeY - ay) * b.vel.x);
    const h0 = ang();
    b.key('ShiftLeft', true);
    let frames = 0;
    while (b.grapple.rope.length > L - 5 + 1e-9 && frames < 200) {
      b.frame(1 / fps);
      frames++;
    }
    b.key('ShiftLeft', false);
    const keptH = (100 * ang()) / h0;
    ok(keptH >= 97, `${fps} fps: 5 m reeled in at 25 m/s through the bottom keeps ${r2(keptH)} % of the angular momentum (${frames} frames)`);
  }
});

// =============================================================================================================
// 4. The pump: reel in within 12 degrees of the bottom, out elsewhere, with the default drag and gravity.
await section(4, 'the pump', async () => {
  const L = 20;
  const AY = 60;
  for (const fps of FPS) {
    let top: unknown = null;
    const { b } = await scene((p) => (top = box(p, [-0.5, AY, -0.5], [0.5, AY + 1, 0.5], false)));
    const ay = AY - 0.05;
    const th = (15 * Math.PI) / 180;
    b.place(L * Math.sin(th), ay - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
    b.physics.stepOnce();
    b.hook(0, AY, 0, 0, -1, 0, top as never, L);
    const amps: number[] = [];
    let cur = 0;
    let lastSign = 0;
    const dt = 1 / fps;
    for (let i = 0; i < 40 * fps && amps.length < 13; i++) {
      const dx = b.pos.x;
      const dy = b.pos.y + GRAPPLE_TUNE.ropeY - ay;
      const a = Math.atan2(dx, -dy);
      const len = b.grapple.rope.length;
      b.key('ShiftLeft', Math.abs(a) < (12 * Math.PI) / 180 && len > 16);
      b.key('KeyX', Math.abs(a) >= (12 * Math.PI) / 180 && len < 20);
      b.frame(dt);
      cur = Math.max(cur, Math.abs(a));
      const s = Math.sign(b.vel.x);
      if (lastSign !== 0 && s !== lastSign) {
        amps.push((cur * 180) / Math.PI);
        cur = 0;
      }
      if (s !== 0) lastSign = s;
    }
    b.key('ShiftLeft', false);
    b.key('KeyX', false);
    const at12 = amps[11] ?? 0;
    ok(at12 >= 60, `${fps} fps: pumping from 15 degrees reaches ${r2(at12)} degrees after 12 half swings (at least 60)`);
  }
});

// =============================================================================================================
// 5 and 12's wall: the ledge, as a cuboid and as the trimesh every placed building is.
await section(5, 'the ledge', async () => {
  const BMIN = [-10, 0, -10];
  const BMAX = [0, 20, 10];
  const ledge = async (fps: number, trimesh: boolean, wrap: boolean) => {
    let bld: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      bld = box(p, BMIN, BMAX, trimesh);
    });
    GRAPPLE_TUNE.wrap = wrap;
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(-0.6, 20, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.hook(-4, 20, 0, 0, 1, 0, bld as never, 12);
    const r = b.grapple.rope;
    const w0 = r.stats.wraps;
    let blockedFrames = 0;
    let maxPen = 0;
    let firstErr = Number.NaN;
    let side = 0;
    let shape = true;
    const impacts: number[] = [];
    b.key('KeyW', true);
    b.run(fps, 8, (t) => {
      if (t >= 0.6) b.key('KeyW', false);
      if (wrap && b.grapple.blocked(b) > 0) blockedFrames++;
      maxPen = Math.max(maxPen, b.penetrationInBox(BMIN, BMAX));
      if (r.n > 0 && Number.isNaN(firstErr)) firstErr = Math.hypot(r.lastContact[0], r.lastContact[1] - 20);
      side = Math.max(side, sideErr(r));
      shape &&= shapeOk(r);
      if (t <= 5 && b.grapple.lastImpact > 0.5) impacts.push(b.grapple.lastImpact);
    });
    return { b, wraps: r.stats.wraps - w0, n: r.n, blockedFrames, maxPen, firstErr, side, shape, feet: b.pos.y, freeErr: Math.abs(handToPivot(b) - r.free()), impacts };
  };
  for (const fps of FPS) {
    for (const trimesh of [true, false]) {
      const shape = trimesh ? 'trimesh' : 'cuboid';
      const on = await ledge(fps, trimesh, true);
      const off = await ledge(fps, trimesh, false);
      ok(on.wraps === 1 && on.n === 1 && on.firstErr < 1e-3, `${fps} fps ${shape}: exactly one bend, its contact ${r3(on.firstErr * 1000)} mm from the lip`);
      ok(on.freeErr < 0.01, `${fps} fps ${shape}: the free span stands ${r3(on.freeErr * 100)} cm off length less spent`);
      ok(on.blockedFrames === 0, `${fps} fps ${shape}: no frame with a blocked span`);
      ok(on.feet - off.feet >= 2.5, `${fps} fps ${shape}: the feet hang ${r2(on.feet)} m up against ${r2(off.feet)} m with wrap off (at least 2.5 m higher)`);
      ok(on.maxPen < 0.01, `${fps} fps ${shape}: the capsule never stands ${r3(on.maxPen * 100)} cm into the building (under 1 cm)`);
      ok(on.side <= 1e-12 && on.shape, `${fps} fps ${shape}: the side worked out again each frame is the side the bend was made with (worst ${on.side.toExponential(1)}), every point on frame 0`);
      if (trimesh) ok(on.impacts.length <= 3 && on.impacts.every((v) => v < 14), `${fps} fps: hanging against the wall 5 s records ${on.impacts.length} impacts over 0.5 m/s (${on.impacts.map(r2).join(', ')}), all under 14`);
    }
  }
});

// =============================================================================================================
await section(6, 'the corner', async () => {
  const BMIN = [-10, 0, -10];
  const BMAX = [0, 30, 0];
  for (const fps of FPS) {
    let bld: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      bld = box(p, BMIN, BMAX, true);
    });
    b.place(4, 18 - GRAPPLE_TUNE.ropeY, 4);
    physics.stepOnce();
    b.hook(-6, 25, 0, 0, 0, 1, bld as never);
    b.vel.set(0, 0, -10);
    const r = b.grapple.rope;
    let worst = 0;
    let lastWraps = r.stats.wraps;
    let side = 0;
    let shape = true;
    const each = () => {
      if (r.stats.wraps !== lastWraps) {
        lastWraps = r.stats.wraps;
        // The building's two north corners, the vertical edges at x 0 and x -10 on z 0.
        worst = Math.max(worst, Math.min(Math.hypot(r.lastContact[0], r.lastContact[2]), Math.hypot(r.lastContact[0] + 10, r.lastContact[2])));
      }
      side = Math.max(side, sideErr(r));
      shape &&= shapeOk(r);
    };
    // Round the north-east corner and back on the swing's own return, then pushed round the north-west one and back.
    b.run(fps, 2.5, each);
    b.vel.set(0, 0, 12);
    b.run(fps, 5, each);
    ok(worst <= 1e-4, `${fps} fps: each corner's bend has its contact within ${worst.toExponential(2)} m of the edge's line`);
    ok(r.stats.wraps === 2 && r.stats.unwraps === 2 && r.n === 0, `${fps} fps: round each corner and back makes ${r.stats.wraps} wraps and ${r.stats.unwraps} unwraps (2 and 2)`);
    ok(side <= 1e-12 && shape, `${fps} fps: the side worked out again is the side made (worst ${side.toExponential(1)})`);
  }
});

// =============================================================================================================
await section(7, 'the trunk', async () => {
  for (const fps of FPS) {
    let wall: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      wall = box(p, [-30, 0, -10], [-20, 45, 10], true);
      trunk(p, 0, 0, 0.4, 0, 50);
    });
    b.place(6, 25 - GRAPPLE_TUNE.ropeY, 5);
    physics.stepOnce();
    b.hook(-20, 40, 0, 1, 0, 0, wall as never);
    b.vel.set(0, 0, -14);
    const r = b.grapple.rope;
    let worst = 0;
    let lastWraps = r.stats.wraps;
    let side = 0;
    b.run(fps, 3, () => {
      if (r.stats.wraps !== lastWraps) {
        lastWraps = r.stats.wraps;
        worst = Math.max(worst, Math.abs(Math.hypot(r.lastContact[0], r.lastContact[2]) - 0.4));
      }
      side = Math.max(side, sideErr(r));
    });
    const nIn = r.n;
    const snap = Array.from(r.pts.subarray(0, 3 * (nIn + 1)));
    const unwraps0 = r.stats.unwraps;
    let minN = nIn;
    // Back the other way round the trunk: 16 m/s along the circle about its axis, against the way it went. On every
    // frame of the unwinding (until the rope first bends again, as it may once it is straight), the bends that are
    // left are exactly the first ones made, point for point: one taken from the anchor's end, or from the middle,
    // shifts every point after it and fails here on any frame that still holds a bend.
    const rr = Math.hypot(b.pos.x, b.pos.z) || 1;
    const turning = Math.sign(b.pos.x * b.vel.z - b.pos.z * b.vel.x) || 1;
    b.vel.set((turning * 16 * b.pos.z) / rr, b.vel.y, (-turning * 16 * b.pos.x) / rr);
    let unwinding = true;
    let lastN = nIn;
    let prefix = true;
    let heldFrames = 0;
    const seen = new Set<number>();
    b.run(fps, 4, () => {
      minN = Math.min(minN, r.n);
      side = Math.max(side, sideErr(r));
      if (r.n > lastN) unwinding = false;
      lastN = r.n;
      if (!unwinding) return;
      seen.add(r.n);
      if (r.n > 0) heldFrames++;
      for (let i = 0; i < 3 * (r.n + 1); i++) if (!Object.is(r.pts[i], snap[i])) prefix = false;
    });
    ok(nIn > 0 && worst < 0.01, `${fps} fps: ${nIn} bends round the trunk, every contact within ${r3(worst * 1000)} mm of its surface (under 1 cm)`);
    ok(r.stats.unwraps > unwraps0 && minN < nIn && prefix && heldFrames > 0 && seen.size >= Math.min(3, nIn), `${fps} fps: swinging back takes the bends off from the last (down to ${minN}, ${r.stats.unwraps - unwraps0} unwraps): on all ${heldFrames} frames still holding a bend, through ${seen.size} counts of bends, the bends left are exactly the first ones made`);
    ok(side <= 1e-12 && shapeOk(r), `${fps} fps: the side worked out again is the side made (worst ${side.toExponential(1)})`);
  }
});

// =============================================================================================================
await section(8, 'the thin post', async () => {
  const caught = async (fan: boolean) => {
    fresh();
    GRAPPLE_TUNE.fan = fan;
    const physics = await makePhysics();
    const wall = box(physics, [-12, 0, -5], [-10, 30, 5], true);
    trunk(physics, 8, 0, 0.08, 0, 40);
    physics.stepOnce();
    const rope = new GrappleRope(RAPIER, physics.world, groups(Group.all, Group.all), null, GRAPPLE_TUNE);
    let n = 0;
    for (let i = 0; i < 200; i++) {
      const z0 = 1.2 + (i % 10) * 0.05;
      rope.attach(-10, 20, 0, 1, 0, 0, wall, 9, 12, z0);
      rope.track({ x: 9, y: 12, z: -z0 - 0.3 });
      if (rope.n > 0) n++;
    }
    return n;
  };
  const withFan = await caught(true);
  const noFan = await caught(false);
  ok(withFan === 200, `an 8 cm post jumped in one frame is caught ${withFan} times of 200 with the fan`);
  ok(noFan <= 120, `and ${noFan} times of 200 with the fan off (at most 120): the fan is what catches them`);
  fresh();
});

// =============================================================================================================
await section(9, 'the cliff', async () => {
  for (const fps of FPS) {
    const { physics, b } = await scene((p) => {
      const h = (x: number) => (x <= -2 ? 20 : 0);
      for (const ox of [-64, 0]) heightChunk(p, ox, -32, (x) => h(x));
    });
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(-2.7, 20.05, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.hook(-6, 20, 0, 0, 1, 0, null, 12);
    const r = b.grapple.rope;
    let blockedFrames = 0;
    let shape = true;
    b.key('KeyW', true);
    b.run(fps, 6, (t) => {
      if (t >= 0.7) b.key('KeyW', false);
      if (b.grapple.blocked(b) > 0) blockedFrames++;
      shape &&= shapeOk(r);
    });
    ok(r.n === 1 && r.groundBends === 1 && blockedFrames === 0 && shape, `${fps} fps: over a heightfield cliff, ${r.n} bend at the ridge (counted on the ground: ${r.groundBends}), ${blockedFrames} frames blocked, feet at ${r2(b.pos.y)} m`);
  }
});

// =============================================================================================================
await section(10, 'the cap', async () => {
  for (const fps of FPS) {
    let tr: unknown = null;
    const { physics, b } = await scene((p) => {
      tr = trunk(p, 0, 0, 0.4, 0, 60);
    });
    b.place(20, 26 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0.4, 30, 0, 1, 0, 0, tr as never);
    let said = '';
    b.grapple.say = (s) => (said = s);
    const r = b.grapple.rope;
    let most = 0;
    const dt = 1 / fps;
    for (let i = 0; i < 60 * fps && b.grapple.attached; i++) {
      const rr = Math.hypot(b.pos.x, b.pos.z) || 1;
      b.vel.x = (-b.pos.z / rr) * 10;
      b.vel.z = (b.pos.x / rr) * 10;
      b.frame(dt);
      most = Math.max(most, r.thingBends);
    }
    ok(b.grapple.state === 'off' && b.grapple.lastLetGo === 'fouled' && r.stats.capped >= 1 && most === GRAPPLE_TUNE.maxWraps && said === 'The line fouled and let go.', `${fps} fps: wound round a trunk, the rope reaches ${most} bends and the 33rd fouls it (${b.grapple.lastLetGo}: "${said}")`);
  }
});

// =============================================================================================================
await section(11, 'streaming', async () => {
  const BMIN = [-10, 0, -10];
  const BMAX = [0, 20, 10];
  for (const fps of FPS) {
    let faults = 0;
    let bld: ReturnType<typeof box> | null = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      bld = box(p, BMIN, BMAX, true);
    });
    try {
      b.forward.set(1, 0, 0);
      b.place(-0.6, 20, 0);
      physics.stepOnce();
      b.run(fps, 0.3);
      b.hook(-4, 20, 0, 0, 1, 0, bld!, 12);
      b.key('KeyW', true);
      b.run(fps, 3, (t) => {
        if (t >= 0.6) b.key('KeyW', false);
      });
      const n0 = b.grapple.rope.n;
      // Rebuilt in place, as a streaming pass rebuilds a building's collider.
      physics.world.removeCollider(bld!, false);
      bld = box(physics, BMIN, BMAX, true);
      physics.stepOnce();
      b.run(fps, 1);
      const rebound = b.grapple.attached && b.grapple.rope.cols[0] === bld;
      // Gone for good.
      physics.world.removeCollider(bld!, false);
      physics.stepOnce();
      b.run(fps, 1);
      ok(n0 === 1 && rebound, `${fps} fps: the anchor's collider rebuilt in place, the rope finds it again and holds`);
      ok(b.grapple.state === 'off' && b.grapple.lastLetGo === 'loose', `${fps} fps: removed for good, the rope lets go (${b.grapple.lastLetGo})`);
    } catch (e) {
      if (isEngineFault(e)) faults++;
      else throw e;
    }
    ok(faults === 0 && !physics.broken, `${fps} fps: no engine fault`);
  }
  // Aboard another world: the anchor's world is never asked.
  {
    let bld: ReturnType<typeof box> | null = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      bld = box(p, BMIN, BMAX, true);
    });
    b.place(-0.6, 20, 0);
    physics.stepOnce();
    b.run(60, 0.3);
    b.hook(-4, 20, 0, 0, 1, 0, bld!, 12);
    b.run(60, 1);
    const other = await makePhysics();
    other.stepOnce();
    physics.world.removeCollider(bld!, false);
    let asked = 0;
    const w = physics.world as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const k of ['castRayAndGetNormal', 'castRay', 'intersectionWithShape']) {
      const was = w[k].bind(physics.world);
      w[k] = (...a: unknown[]) => {
        asked++;
        return was(...a);
      };
    }
    const aboard = { ...b, pos: b.pos, vel: b.vel, physics: other, body: b.body, collider: b.collider, controller: b.controller, jka: b.jka, grounded: false, swimming: false, depth: -1, inside: false, colliderOffsetY: b.colliderOffsetY, filter: b.filter };
    let fault = 0;
    try {
      b.grapple.beforeMove(aboard, 1 / 60);
      b.grapple.afterMove(aboard, 1 / 60);
    } catch (e) {
      if (isEngineFault(e)) fault++;
      else throw e;
    }
    ok(asked === 0 && b.grapple.state === 'off' && b.grapple.lastLetGo === 'world' && fault === 0, `with the body aboard another world, the anchor's world is never asked (${asked} queries) and the rope lets go (${b.grapple.lastLetGo})`);
  }
});

// =============================================================================================================
await section(12, 'what fights it', async () => {
  // The scrape at the bottom: the slide rule keeps the speed, the latch held through it.
  for (const fps of FPS) {
    let top: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      top = box(p, [-0.5, 20, -0.5], [0.5, 21, 0.5], false);
    });
    const L = 18.7;
    const th = Math.PI / 3;
    b.place(L * Math.sin(th), 19.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 20, 0, 0, -1, 0, top as never, L);
    let speedAtBottom = 0;
    let latchHeld = true;
    let slid = 0;
    let passed = false;
    const dt = 1 / fps;
    for (let i = 0; i < 3 * fps; i++) {
      const wasX = b.pos.x;
      b.frame(dt);
      if (!passed && b.grounded && !b.grapple.latch) latchHeld = false;
      if (b.grapple.modes.sliding) slid++;
      if (!passed && wasX > 0 && b.pos.x <= 0) {
        passed = true;
        speedAtBottom = b.vel.length();
      }
    }
    ok(speedAtBottom >= 18 && latchHeld && slid > 0, `${fps} fps: a swing scraping 5 cm of ground keeps ${r2(speedAtBottom)} m/s through the bottom (at least 18), latched and sliding (${slid} frames)`);
  }
  // The sync: a 35 m/s swing into a wall at 144 fps over twelve phases of the 60 Hz step.
  {
    const WMIN = [-3, 0, -10];
    const WMAX = [-1.2, 60, 10];
    const slam = async (sync: boolean, k: number) => {
      let top: unknown = null;
      const { physics, b } = await scene((p) => {
        ground(p, -200);
        top = box(p, [-0.5, 60, -0.5], [0.5, 61, 0.5], false);
        box(p, WMIN, WMAX, false);
      });
      GRAPPLE_TUNE.syncCollider = sync;
      const L = 30 + k * 0.137;
      b.place(L, 59.95 - GRAPPLE_TUNE.ropeY, 0);
      physics.stepOnce();
      b.hook(0, 60, 0, 0, -1, 0, top as never, L);
      physics.step(k / 12 / 60);
      let pen = 0;
      b.run(144, 3, () => (pen = Math.max(pen, b.penetrationInBox(WMIN, WMAX))));
      return pen;
    };
    let on = 0;
    let off = 0;
    for (let k = 0; k < 12; k++) {
      on = Math.max(on, await slam(true, k));
      off = Math.max(off, await slam(false, k));
    }
    ok(on < 0.01, `144 fps: a 35 m/s swing into a wall over 12 phases goes ${r3(on * 100)} cm into it with the collider synced (under 1 cm)`);
    ok(off > 0.3, `144 fps: and ${r3(off * 100)} cm without the sync (over 30 cm): the test sees the fault`);
    fresh();
  }
  // The sync follows the capsule: crouched on the ground with the rope in.
  for (const fps of FPS) {
    let wall: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      wall = box(p, [-25, 0, -20], [-20, 30, 20], true);
    });
    b.place(0, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.hook(-20, 1.3, 0, 1, 0, 0, wall as never, 25);
    b.crouchHeld = true;
    let worst = 0;
    let writes = 0;
    const set = b.collider.setTranslation.bind(b.collider);
    b.collider.setTranslation = (t: { x: number; y: number; z: number }) => {
      if (b.grapple.attached) {
        writes++;
        worst = Math.max(worst, Math.abs(t.y - (CAPSULE_RADIUS + CROUCH_HALF_HEIGHT) - b.pos.y));
      }
      set(t);
    };
    b.run(fps, 1);
    ok(writes > 0 && worst < 1e-3 && Math.abs(b.colliderOffsetY - (CAPSULE_RADIUS + CROUCH_HALF_HEIGHT)) < 1e-9, `${fps} fps: crouched with the rope in, the synced capsule's foot stands ${r3(worst * 1000)} mm from the feet (under 1 mm, ${writes} writes)`);
  }
});

// =============================================================================================================
await section(13, 'the fall', async () => {
  // Released at the far top of a swing 28.65 m up.
  for (const fps of FPS) {
    for (const level of [0, 3]) {
      let top: unknown = null;
      const { physics, b } = await scene((p) => {
        ground(p, 0);
        top = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
      });
      b.jka.forceLevel = level;
      const L = 20;
      const th = Math.PI / 3;
      b.place(L * Math.sin(th), 39.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
      physics.stepOnce();
      b.hook(0, 40, 0, 0, -1, 0, top as never, L);
      const dt = 1 / fps;
      let releaseY = Number.NaN;
      let landedFor = -1;
      for (let i = 0; i < 8 * fps; i++) {
        const vx0 = b.vel.x;
        b.frame(dt);
        if (Number.isNaN(releaseY) && b.pos.x < 0 && vx0 < 0 && b.vel.x >= 0) {
          releaseY = b.pos.y;
          b.grapple.letGo('fire');
        }
        if (!Number.isNaN(releaseY) && b.grounded) landedFor++;
        if (landedFor >= 3) break;
      }
      ok(b.fallDamage === 60, `${fps} fps, Force ${level}: let go at the far top ${r2(releaseY)} m up, the landing costs ${b.fallDamage} (60)`);
    }
  }
  // Released 1 m up after a 30 m-high swing on a taut rope.
  for (const fps of FPS) {
    let top: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      top = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
    });
    b.jka.forceLevel = 0;
    const L = 37.65;
    const th = Math.acos((39.95 - 1.3 - 30) / L);
    b.place(L * Math.sin(th), 39.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, top as never, L);
    const startY = b.pos.y;
    const dt = 1 / fps;
    let releaseY = Number.NaN;
    let landed = -1;
    for (let i = 0; i < 8 * fps; i++) {
      const x0 = b.pos.x;
      b.frame(dt);
      if (Number.isNaN(releaseY) && x0 > 0 && b.pos.x <= 0) {
        releaseY = b.pos.y;
        b.grapple.letGo('fire');
      }
      if (!Number.isNaN(releaseY) && b.grounded) landed++;
      if (landed >= 3) break;
    }
    ok(b.fallDamage === 0 && startY > 29, `${fps} fps: a swing from ${r2(startY)} m let go ${r2(releaseY)} m up costs ${b.fallDamage} at Force 0`);
  }
  // A slide down a slope: a taut latched swing, a slack run, and the slack run with the slide forced on.
  const slope = async (fps: number, level: number, how: 'taut' | 'slack' | 'forced') => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      for (const ox of [-64, 0]) for (const oz of [-64, 0]) heightChunk(p, ox, oz, (x) => -0.5 * x);
      beam = box(p, [-0.5, 10, 6.5], [0.5, 11, 7.5], false);
    });
    b.jka.forceLevel = level;
    // Off the seam between the heightfield chunks at z 0, where a body running along it is kicked up.
    b.place(-12, 6.02, 7);
    physics.stepOnce();
    b.run(fps, 0.2);
    const y0 = b.pos.y;
    b.hook(0, 10, 7, 0, -1, 0, beam as never, how === 'taut' ? -1 : 40);
    const dt = 1 / fps;
    let path = 0;
    let slid = 0;
    let latchedTaut = 0;
    let lowest = Number.POSITIVE_INFINITY;
    if (how === 'taut') {
      b.grapple.latch = true;
      b.vel.set(0, 0, 12);
      for (let i = 0; i < 10 * fps; i++) {
        const x = b.pos.x;
        const y = b.pos.y;
        const z = b.pos.z;
        b.frame(dt);
        path += Math.hypot(b.pos.x - x, b.pos.y - y, b.pos.z - z);
        lowest = Math.min(lowest, b.pos.y);
        if (b.grapple.modes.sliding) slid++;
        if (b.grapple.latch && b.grapple.taut && b.grounded) latchedTaut++;
      }
    } else {
      b.forceSlide = how === 'forced';
      for (let i = 0; i < 1.9 * fps; i++) {
        const x = b.pos.x;
        b.vel.x = 10;
        b.frame(dt);
        path += Math.abs(b.pos.x - x);
      }
      b.forceSlide = false;
      b.run(fps, 3);
    }
    return { b, path, slid, latchedTaut, drop: y0 - b.pos.y, fell: y0 - lowest };
  };
  for (const fps of FPS) {
    for (const level of [0, 3]) {
      const t = await slope(fps, level, 'taut');
      ok(t.b.fallDamage === 0 && t.path >= 15 && t.slid > 0 && t.latchedTaut > 0 && t.fell >= 4 && t.b.vel.length() < 1, `${fps} fps, Force ${level}: a taut latched swing runs ${r2(t.path)} m over the slope (${t.slid} frames sliding on it), reaching ${r2(t.fell)} m under where it began, ends slowed to ${r2(t.b.vel.length())} m/s, and costs ${t.b.fallDamage}`);
      const s = await slope(fps, level, 'slack');
      ok(s.b.fallDamage === 0 && s.path >= 15, `${fps} fps, Force ${level}: run ${r2(s.path)} m down the slope at 10 m/s on a slack rope (${r2(s.drop)} m down), it costs ${s.b.fallDamage}`);
      const f = await slope(fps, level, 'forced');
      ok(f.b.fallDamage === 0 && f.path >= 15, `${fps} fps, Force ${level}: the same run with the slide forced on regardless (${r2(f.drop)} m down) costs ${f.b.fallDamage}: the ground half of the apex rule on its own`);
    }
  }
});

// =============================================================================================================
await section(14, 'the haul', async () => {
  // Under a 20 m ledge, the anchor 4 m back on the roof: up and over the lip, and standing there.
  for (const fps of FPS) {
    let bld: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      bld = box(p, [-10, 0, -10], [0, 20, 10], true);
    });
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(-0.6, 20, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.hook(-4, 20, 0, 0, 1, 0, bld as never, 12);
    b.key('KeyW', true);
    b.run(fps, 6, (t) => {
      if (t >= 0.6) b.key('KeyW', false);
    });
    const hungAt = b.pos.y;
    b.key('KeyF', true);
    let worst = 0;
    let at = 0;
    const dt = 1 / fps;
    for (let i = 0; i < 6 * fps && b.grapple.attached; i++) {
      b.frame(dt);
      at += dt;
      if (b.grapple.attached) worst = Math.max(worst, b.grapple.lastImpact);
    }
    b.key('KeyF', false);
    ok(b.grapple.lastLetGo === 'arrived' && b.pos.y > 19.9 && Math.hypot(b.pos.x + 4, b.pos.z) < GRAPPLE_TUNE.arriveReach + 0.1, `${fps} fps: hanging ${r2(hungAt)} m up under the lip, F hauls up and over it and stands at the anchor in ${r2(at)} s (${b.grapple.lastLetGo})`);
    ok(worst < 13.5, `${fps} fps: the haul never meets the wall faster than ${r2(worst)} m/s (under 13.5)`);
  }
  // From 20 m out to an anchor on the ground.
  for (const fps of FPS) {
    let gr: unknown = null;
    const { physics, b } = await scene((p) => {
      gr = ground(p, 0);
    });
    b.place(20, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.hook(0, 0, 0, 0, 1, 0, gr as never);
    const x0 = b.pos.x;
    b.key('KeyF', true);
    let worst = 0;
    let at = 0;
    const dt = 1 / fps;
    for (let i = 0; i < 4 * fps && b.grapple.attached; i++) {
      b.frame(dt);
      at += dt;
      if (b.grapple.attached) worst = Math.max(worst, b.grapple.lastImpact);
    }
    b.key('KeyF', false);
    const ideal = (x0 - 0.05 - GRAPPLE_TUNE.arriveReach) / GRAPPLE_TUNE.haul;
    ok(b.grapple.lastLetGo === 'arrived' && worst <= 4, `${fps} fps: hauled from 20 m out to a ground anchor, it arrives (${b.grapple.lastLetGo}) and no contact on the way is faster than ${r2(worst)} m/s (at most 4)`);
    ok(Math.abs(at - ideal) <= 0.1 + dt, `${fps} fps: in ${r3(at)} s, within 0.1 s of a straight haul to the anchor at the haul's speed (${r3(ideal)} s)`);
  }
  // Straight at an anchor on a sheer face: the haul arrives at rest.
  const face = async (fps: number, arrive: boolean) => {
    let wall: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      wall = box(p, [-3, 0, -10], [-1.2, 30, 10], true);
    });
    GRAPPLE_TUNE.haulArrive = arrive;
    b.place(14, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.hook(-1.2, 10, 0, 1, 0, 0, wall as never);
    b.key('KeyF', true);
    let ended = -1;
    let worstAfter = 0;
    let firstTenth = 0;
    let worstHauled = 0;
    let wasHauling = false;
    const dt = 1 / fps;
    for (let i = 0; i < 4 * fps && b.grapple.attached; i++) {
      b.frame(dt);
      if (ended < 0 && wasHauling && !b.grapple.hauling) ended = 0;
      else if (ended >= 0) ended += dt;
      // The frame the haul ends on is the first after it: its move is the one that would carry the haul's speed.
      // Both arms are measured over the very same frames, those after the haul's last step and never that step.
      if (ended >= 0) {
        worstAfter = Math.max(worstAfter, b.grapple.lastImpact);
        if (ended <= 0.1 + 1e-9) firstTenth = Math.max(firstTenth, b.grapple.lastImpact);
      } else if (b.grapple.hauling) worstHauled = Math.max(worstHauled, b.grapple.lastImpact);
      wasHauling = b.grapple.hauling;
      if (ended > 1) break;
    }
    b.key('KeyF', false);
    return { ended, worstAfter, firstTenth, worstHauled };
  };
  for (const fps of FPS) {
    const on = await face(fps, true);
    const off = await face(fps, false);
    // The haul's last step stops at the shortest, so the haul itself never reaches the face at any frame rate (a
    // step of 0.3 m at 60 fps and 0.6 at 30 that ended inside it struck the face at 15.9 and 10.3 m/s).
    ok(on.ended >= 0 && on.worstHauled <= 1 && off.worstHauled <= 1, `${fps} fps: hauled at a sheer face, the haul's own steps meet it at ${r2(Math.max(on.worstHauled, off.worstHauled))} m/s at most (its last step stops at minFree, clear of the face)`);
    ok(on.worstAfter <= 5, `${fps} fps: once it ends at minFree, no contact after is faster than ${r2(on.worstAfter)} m/s (at most 5)`);
    ok(off.ended >= 0 && off.firstTenth > 5, `${fps} fps: with the arrival off, the same frames carry the haul's own speed into the face at ${r2(off.firstTenth)} m/s within a tenth of a second (past the 5 the check allows): the test sees the fault`);
  }
  fresh();
});

// =============================================================================================================
await section(15, 'the boost', async () => {
  const apex = async (fps: number, boost: boolean) => {
    let top: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      top = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
    });
    const L = 20;
    const th = Math.PI / 3;
    b.place(L * Math.sin(th), 39.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, top as never, L);
    const dt = 1 / fps;
    let let_ = false;
    let high = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 6 * fps; i++) {
      const vx0 = b.vel.x;
      if (!let_ && b.pos.x < -L * Math.sin(Math.PI / 6) && vx0 < 0) {
        let_ = true;
        tap(b, boost ? 'Space' : 'Mouse3', dt);
        continue;
      }
      b.frame(dt);
      if (let_) high = Math.max(high, b.pos.y);
    }
    return { high, why: b.grapple.lastLetGo };
  };
  for (const fps of FPS) {
    const plain = await apex(fps, false);
    const boosted = await apex(fps, true);
    ok(boosted.why === 'boost' && plain.why === 'fire' && boosted.high - plain.high >= 3.5, `${fps} fps: boosted 30 degrees past the bottom the apex is ${r2(boosted.high)} m against a plain release's ${r2(plain.high)} m (at least 3.5 m higher)`);
  }
});

// =============================================================================================================
await section(16, 'the dart', async () => {
  // Aimed true from a body moving 0 to 45 m/s any way.
  for (const fps of FPS) {
    let rnd = 12345 + fps;
    const rand = () => {
      rnd = (rnd * 1664525 + 1013904223) >>> 0;
      return rnd / 4294967296;
    };
    let worst = 0;
    let bit = 0;
    const tries = 30;
    for (let k = 0; k < tries; k++) {
      const { physics, b } = await scene((p) => box(p, [-42, 0, -100], [-40, 200, 100], true));
      b.place(0, 100, 0);
      physics.stepOnce();
      const sp = 45 * rand();
      const u = rand() * 2 - 1;
      const a = rand() * 2 * Math.PI;
      const s = Math.sqrt(1 - u * u);
      b.vel.set(sp * s * Math.cos(a), sp * u, sp * s * Math.sin(a));
      b.fireAt = { x: -40, y: 101.3 + (rand() - 0.5) * 20, z: (rand() - 0.5) * 40 };
      const dt = 1 / fps;
      tap(b, 'Mouse3', dt);
      const g = b.grapple;
      const mark = { x: g.mark.x, y: g.mark.y, z: g.mark.z };
      for (let i = 0; i < 2 * fps && g.flying; i++) b.frame(dt);
      if (g.attached) {
        bit++;
        worst = Math.max(worst, Math.hypot(g.dart[0] - mark.x, g.dart[1] - mark.y, g.dart[2] - mark.z));
      }
    }
    ok(bit === tries && worst < 0.01, `${fps} fps: aimed true from a body moving 0 to 45 m/s any way, ${bit} of ${tries} darts land within ${r3(worst * 1000)} mm of the mark (under 1 cm)`);
  }
  // What the mark says of each kind of collider.
  {
    let wall: ReturnType<typeof box> | null = null;
    const things: Record<string, RAPIER.Collider> = {};
    const { physics, b } = await scene((p) => {
      wall = box(p, [-32, -5, -40], [-30, 40, 40], true);
      heightChunk(p, -64, -32, () => 0);
      heightChunk(p, 0, -32, () => 0);
      things.trimesh = box(p, [-10.5, 0, -1], [-9.5, 10, 1], true);
      things.cylinder = trunk(p, -10, 4, 0.5, 0, 10)!;
      const kin = p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-10, 5, 8));
      things.kinematic = p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 5, 1), kin);
      const door = p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-10, 5, 12));
      things.door = p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 5, 1), door);
      p.markWall(things.door, true);
      const dyn = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-10, 5, 16).setGravityScale(0));
      things.dynamic = p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), dyn);
      const rag = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-10, 5, -4).setGravityScale(0));
      things.ragdoll = p.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.3), rag);
      p.markRagdoll(things.ragdoll, 1);
      things.walkThrough = p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 5, 1).setTranslation(-10, 5, -8));
      p.markWalkThrough(things.walkThrough, true);
      const peer = p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-10, 5, -12));
      things.peer = p.world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.4).setSensor(true).setCollisionGroups(groups(Group.peer, 0)), peer);
      p.markPeer(things.peer);
    });
    b.place(10, 0.02, 0);
    physics.stepOnce();
    b.run(60, 0.2);
    const g = b.grapple;
    let h = b.hand();
    const look = (x: number, y: number, z: number) => {
      h = b.hand();
      const d = new THREE.Vector3(x, y, z).sub(h).normalize();
      g.mark.holdLeft = 0;
      probeFrom(g, physics, h, d, 0, h, b.filter, b.body, null);
      return { kind: g.mark.kind, shows: g.mark.shows, x: g.mark.x, collider: g.mark.collider };
    };
    const ground0 = look(-5, 0, 0);
    ok(ground0.kind === 'terrain' && ground0.shows, `the ground's heightfield holds (${ground0.kind})`);
    const tm = look(-9.5, 5, 0);
    ok(tm.kind === 'still' && tm.shows, `a trimesh holds (${tm.kind})`);
    const cy = look(-9.5, 5, 4);
    ok(cy.kind === 'still' && cy.shows, `a cylinder holds (${cy.kind})`);
    const kin = look(-9.5, 5, 8);
    ok(kin.kind === 'moving' && !kin.shows, `a kinematic body stops the mark and is refused (${kin.kind})`);
    const door = look(-9.5, 5, 12);
    ok(door.kind === 'door' && !door.shows, `a door stops the mark and is refused (${door.kind})`);
    const dyn = look(-9.5, 5, 16);
    ok(dyn.kind === 'moving' && !dyn.shows, `a dynamic body stops the mark and is refused (${dyn.kind})`);
    const rag = look(-9.5, 5, -4);
    const walk = look(-9.5, 5, -8);
    const peer = look(-9.5, 5, -12);
    ok(rag.kind === 'still' && rag.collider === wall && walk.collider === wall && peer.collider === wall && walk.shows && peer.shows, `a ragdoll piece, a walk-through and a peer's sensor are passed: the mark lands on the wall behind each`);
    // A dart fired at the dynamic body stops on it and comes home.
    const misses = g.counts.misses;
    g.fire(-9.5, 5, 16, h, b.vel, physics, b.filter, b.body, -1, 0, 0);
    b.run(60, 1);
    ok(g.counts.misses === misses + 1 && g.state === 'off', `a dart fired at a dynamic body stops on it, is refused, and comes home`);
    // Under 1.5 m.
    b.place(-8.6, 0.02, 0);
    physics.stepOnce();
    b.run(60, 0.2);
    const near = look(-9.5, 1.32, 0);
    ok(near.kind === 'still' && !near.shows, `a wall under 1.5 m off is refused (${r2(g.mark.distance)} m)`);
  }
  // A pane: it stops the dart and is refused, and the rope bends on one.
  {
    let pane: ReturnType<typeof box> | null = null;
    let anchor: ReturnType<typeof box> | null = null;
    const { physics, b } = await scene((p) => {
      anchor = box(p, [-12, 0, -5], [-10, 30, 5], true);
      pane = box(p, [-5, 10, -3], [-4.9, 18, 3], true);
      p.markPane(pane.handle, true);
    });
    b.place(5, 12 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    const g = b.grapple;
    const h = b.hand();
    const d = new THREE.Vector3(-4.9, 13, 0).sub(h).normalize();
    probeFrom(g, physics, h, d, 0, h, b.filter, b.body, null);
    ok(g.mark.kind === 'pane' && !g.mark.shows, `a window's pane stops the mark and is refused (${g.mark.kind})`);
    const misses = g.counts.misses;
    g.fire(-4.9, 13, 0, h, b.vel, physics, b.filter, b.body, d.x, d.y, d.z);
    for (let i = 0; i < 30 && g.flying && !g.returning; i++) b.frame(1 / 60);
    ok(g.counts.misses === misses + 1, 'a dart fired at a pane stops on it and is refused');
    const rope = new GrappleRope(RAPIER, physics.world, groups(Group.all, Group.all), null, GRAPPLE_TUNE);
    rope.attach(-10, 20, 0, 1, 0, 0, anchor!, 5, 21, 0);
    for (let i = 1; i <= 40; i++) rope.track({ x: 5, y: 21 - (11 * i) / 40, z: 0 });
    ok(rope.n >= 1 && rope.cols[1] === pane && rope.blockedNow(5, 10, 0) === 0, `the rope bends on a pane (${rope.n} bend on it, nothing blocked)`);
  }
  // A miss returns.
  for (const fps of FPS) {
    const { physics, b } = await scene();
    b.place(0, 100, 0);
    physics.stepOnce();
    const g = b.grapple;
    g.fire(-200, 100, 0, b.hand(), b.vel, physics, b.filter, b.body, -1, 0, 0);
    let returned = false;
    for (let i = 0; i < 2 * fps; i++) {
      b.frame(1 / fps);
      if (g.returning) returned = true;
      if (g.state === 'off') break;
    }
    ok(returned && g.state === 'off' && g.counts.misses === 1, `${fps} fps: a dart that meets nothing in range comes home and the hook is free`);
  }
});

// =============================================================================================================
await section(17, 'allocation', async () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) {
    note('skip allocation: run with node --expose-gc to measure');
    return;
  }
  let scavenges = 0;
  const watch = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
  });
  watch.observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
  const tick = () => new Promise((r) => setImmediate(r));
  // The observer is told of a collection a turn of the loop or two after it ran (measured: one turn reports none of
  // a dozen, two report all of them), so a window's collections are read only after two turns; read after one, a
  // window that collected read as clean, and what it made as whatever the young generation held at its end.
  const settle = async () => {
    await tick();
    await tick();
  };
  // Before a measurement: a full collection; then `warm` calls, which optimise again whatever code the collection
  // threw away; then a minor collection to empty the young generation those calls filled (a minor one throws no
  // code away); and the observer told of both before the count starts again.
  const minor = gc as unknown as (o: { type: 'minor' }) => void;
  const ready = async (warm: number, fn: () => void) => {
    gc();
    await settle();
    for (let k = 0; k < warm; k++) fn();
    minor({ type: 'minor' });
    await settle();
    scavenges = 0;
  };
  /**
   * Bytes the young generation grew by over `frames` calls, the cleanest of three, with no collection inside. Each try
   * starts from a full collection and then makes `warm` calls before it measures (and the first try `first` more): a
   * full collection throws away optimised code built round an object that has since died, and the calls that run
   * before it is optimised again box every number they touch, which read as the hook's own (measured: 16 to 59 B a
   * frame over windows of 2,000 frames each after its own collection, against 0.04 sampled in the steady state).
   */
  const measure = async (frames: number, step: (i: number) => void, warm = Math.max(5000, frames >> 2), first = 100_000, tries = 3) => {
    for (let i = 0; i < first; i++) step(i);
    let best = { made: Infinity, scavenges: Infinity };
    let w = 0;
    const warmStep = () => step(w++);
    for (let attempt = 0; attempt < tries; attempt++) {
      await ready(warm, warmStep);
      const before = young();
      for (let i = 0; i < frames; i++) step(i);
      const made = young() - before;
      await settle();
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made <= 0) break;
    }
    return best;
  };
  // The scene: hanging off a roof's lip, the hand moving a little each frame.
  let bld: ReturnType<typeof box> | null = null;
  const { physics, b } = await scene((p) => {
    ground(p, 0);
    bld = box(p, [-10, 0, -10], [0, 20, 10], true);
  });
  b.forward.set(1, 0, 0);
  b.place(-0.6, 20, 0);
  physics.stepOnce();
  b.run(60, 0.3);
  b.hook(-4, 20, 0, 0, 1, 0, bld!, 12);
  b.key('KeyW', true);
  b.run(60, 3, (t) => {
    if (t >= 0.6) b.key('KeyW', false);
  });
  const g = b.grapple;
  const base = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(6, 12, 6);
  const ribbon = new RopeRibbon(g.rope.capacity, GRAPPLE_TUNE.sagSegments);
  const mutes: string[] = [];
  const vel = { x: 1.5, y: -2.5, z: 0.5 };
  const corr = { x: 0.5, y: 0.5, z: 0.5 };
  const hand = { x: 0.4, y: 18.5, z: 0.5 };
  const hand1 = { x: 0.41, y: 18.01, z: 0.5 };
  const piv = { x: 0.03, y: 20.03, z: 0.5 };
  const DT = 1 / 60;
  const FRAMES = 200_000;
  // Called as the game calls them: points as objects and numbers in fields, so the test makes no number of its own.
  const own = await measure(FRAMES, (i) => {
    g.refreshModes(b);
    vel.x = 1 + (i & 7) * 0.01;
    hand.y = 18 + (i & 3) * 0.01;
    g.con.free = 7.9;
    g.con.reel = 0;
    g.con.apply(vel, hand, piv, DT, corr, GRAPPLE_TUNE);
    g.con.taut = true;
    g.con.follow(vel, hand, hand1, piv, piv);
    grappleMutes(mutes, true, ((i >> 15) & 1) === 0);
    ribbon.slack = 0.05 * (i & 3);
    ribbon.screenH = 1080;
    ribbon.lay(g.rope.pts, g.rope.n + 1, hand, camera);
  });
  ok(own.scavenges === 0 && own.made < 0.2 * FRAMES, `the grapple's own arithmetic (modes, constraint, carry, mutes, the ribbon's lay) makes ${Math.max(0, own.made)} bytes over ${FRAMES} frames (under 0.2 B a frame, ${own.scavenges} collections)`);
  // (b) The whole per-frame path, the engine's queries included. What the engine's own wrappers make a query is
  // measured here first, in the same scene and the same way, each kind apart (a cast that meets nothing, one that
  // meets something, a fan that meets nothing and one that does, a contact read off the controller), because it
  // is what it is: 570 to 1,200 B a cast, measured, the raw vectors and the answer every call wraps, which is the
  // standing CLAUDE.md accepts. The path may make no more than a tenth over what its own queries cost: measured in
  // windows the young generation can hold, warmed first. The calibrations move by a tenth from run to run, so this
  // is a sanity check of the path against the engine; the hold on the hook's own code is (d).
  const r = g.rope;
  // A fan through the roof, which meets it.
  const ROOF_FAN = [-5, 21, 0, -5, 21, 0, -6, 19, 0, -4, 19, 0];
  const kept = new RAPIER.CharacterCollision();
  // Measured as everything here is, warmed again after each collection, and the median of seven clean measurements:
  // measured straight after a collection, the least of several came out 15% under the usual on one run in five.
  const perCall = async (fn: () => void) => {
    for (let k = 0; k < 20_000; k++) fn();
    const clean: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      await ready(5000, fn);
      const before = young();
      for (let k = 0; k < 2000; k++) fn();
      const m = young() - before;
      await settle();
      if (scavenges === 0) clean.push(m);
    }
    clean.sort((x, y) => x - y);
    return clean.length ? clean[clean.length >> 1] / 2000 : Infinity;
  };
  // On the frame's own spans: what a query costs the engine's glue depends on what its box passes (measured: a
  // miss over open air about 290 B, the same miss down this wall 570 to 760), so each kind is measured where the
  // frame asks it, the hit through the roof.
  const pv0 = { x: r.pts[3 * r.n], y: r.pts[3 * r.n + 1], z: r.pts[3 * r.n + 2] };
  const h0 = { x: base.x, y: base.y + GRAPPLE_TUNE.ropeY, z: base.z };
  const RF = r as unknown as { fw: Float64Array; fanHit(): boolean };
  const fanOn = (dx: number) => {
    RF.fw[0] = RF.fw[3] = pv0.x;
    RF.fw[1] = RF.fw[4] = pv0.y;
    RF.fw[2] = RF.fw[5] = pv0.z;
    RF.fw[6] = h0.x;
    RF.fw[7] = h0.y;
    RF.fw[8] = h0.z;
    RF.fw[9] = h0.x + dx;
    RF.fw[10] = h0.y;
    RF.fw[11] = h0.z + dx;
    return RF.fanHit();
  };
  const castMiss = await perCall(() => r.clear(pv0.x, pv0.y, pv0.z, h0.x, h0.y, h0.z));
  const castHit = await perCall(() => r.clear(-5, 21, 0, -5, 19, 0));
  const fanMiss = await perCall(() => fanOn(0.002));
  const fanHit = await perCall(() => {
    RF.fw.set(ROOF_FAN);
    return RF.fanHit();
  });
  // A contact as the clip reads it: the record, and the body the collider hangs on.
  const contact = b.controller.numComputedCollisions() > 0 ? await perCall(() => b.controller.computedCollision(0, kept)?.collider?.parent()) : 0;
  // A window the young generation holds whole, so a collection inside one is rare and, read after the settle, is
  // seen and the window measured again.
  const WINDOW = 2000;
  let made = 0;
  let allowed = 0;
  let frames = 0;
  let dirty = 0;
  let queries = 0;
  let i = 0;
  let contacts = 0;
  const step = () => {
    const a = (i++ % 360) * (Math.PI / 180);
    b.pos.x = base.x + 0.05 * Math.cos(a);
    b.pos.y = base.y + 0.05 * Math.sin(a);
    b.pos.z = base.z + 0.1 * Math.sin(a);
    g.beforeMove(b, DT);
    g.syncCollider(b);
    g.clip(b);
    contacts += b.controller.numComputedCollisions();
    g.afterMove(b, DT);
  };
  // Warmed first, as the nebula test warms its ticks, so what is measured is the optimised code a session runs.
  for (let k = 0; k < 100_000; k++) step();
  for (let w = 0; w < FRAMES / WINDOW; w++) {
    let best: { made: number; allowed: number; queries: number } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await ready(WINDOW, step);
      const s0 = { casts: r.stats.casts, hits: r.stats.castHits, fans: r.stats.fans, met: r.stats.fanMet, contacts };
      const before = young();
      for (let k = 0; k < WINDOW; k++) step();
      const m = young() - before;
      await settle();
      const hits = r.stats.castHits - s0.hits;
      const misses = r.stats.casts - s0.casts - hits;
      const met = r.stats.fanMet - s0.met;
      const fans = r.stats.fans - s0.fans - met;
      const cs = contacts - s0.contacts;
      const may = 1.1 * (misses * castMiss + hits * castHit + fans * fanMiss + met * fanHit + cs * contact);
      if (scavenges === 0 && (!best || m < best.made)) best = { made: m, allowed: may, queries: misses + hits + fans + met + cs };
      if (best) break;
    }
    if (!best) {
      dirty++;
      continue;
    }
    made += best.made;
    allowed += best.allowed;
    queries += best.queries;
    frames += WINDOW;
  }
  note(`the engine's own wrappers make ${r2(castMiss)} B a cast that misses, ${r2(castHit)} B one that hits, ${r2(fanMiss)} and ${r2(fanHit)} B a fan, ${r2(contact)} B a contact read`);
  // A bound worked out from calibrations is a sanity check, not a hold on the hook's own code: its slack is tens of
  // bytes a frame. That hold is (d) below, with the engine's answers kept.
  ok(g.attached && frames >= FRAMES * 0.9 && made <= allowed + 0.2 * frames, `the whole per-frame path makes ${made} bytes over ${frames} frames and ${queries} engine queries, against the ${r2(allowed)} its queries cost (plus 0.2 B a frame; ${dirty} windows unmeasurable)`);

  // (c) The mark, which every player on foot works out every frame whether or not they ever fire: its two casts of
  // the engine's, against those two casts asked of the engine on their own with the very same rays, which is the
  // engine's cost and nothing of the hook's. Its rays pass no predicate unless what they meet is a thing they pass,
  // and it reads its view out of a kept record the caller writes, as the game's `stepGrappleMark` writes it.
  const eye = new THREE.Vector3(8, 14, 3);
  const look = new THREE.Vector3(-8, -2, -3).normalize();
  const view = { orbit: 0 };
  // A rope point out in the street, 4 m from the wall the camera looks at, so the mark shows.
  const markHand = { x: 4, y: 12, z: 1 };
  const markFilter = b.filter;
  const noWater = (_p: { x: number; y: number; z: number }): boolean => false;
  const mv = g.view;
  const markStep = () => {
    mv.eyeX = eye.x;
    mv.eyeY = eye.y;
    mv.eyeZ = eye.z;
    mv.dirX = look.x;
    mv.dirY = look.y;
    mv.dirZ = look.z;
    mv.orbit = view.orbit;
    mv.hand = markHand;
    mv.filter = markFilter;
    mv.exclude = b.body;
    g.probeMark(physics, noWater, DT);
  };
  markStep();
  const markShown = g.mark.shows;
  const flagsM = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  const lenA = GRAPPLE_TUNE.range + GRAPPLE_TUNE.probePad;
  const rayA = new RAPIER.Ray({ x: eye.x, y: eye.y, z: eye.z }, { x: look.x, y: look.y, z: look.z });
  const hitA = physics.world.castRayAndGetNormal(rayA, lenA, true, flagsM, markFilter, undefined, b.body);
  const pA = hitA ? { x: eye.x + look.x * hitA.timeOfImpact, y: eye.y + look.y * hitA.timeOfImpact, z: eye.z + look.z * hitA.timeOfImpact } : { x: 0, y: 0, z: 0 };
  const segLen = Math.hypot(pA.x - markHand.x, pA.y - markHand.y, pA.z - markHand.z);
  const rayB = new RAPIER.Ray({ ...markHand }, { x: (pA.x - markHand.x) / segLen, y: (pA.y - markHand.y) / segLen, z: (pA.z - markHand.z) / segLen });
  const lenB = segLen + 0.05;
  const engineTwo = await perCall(() => {
    physics.world.castRayAndGetNormal(rayA, lenA, true, flagsM, markFilter, undefined, b.body);
    physics.world.castRayAndGetNormal(rayB, lenB, true, flagsM, markFilter, undefined, b.body);
  });
  const markOwn = await perCall(markStep);
  note(`the mark makes ${r2(markOwn)} B a frame against the real engine; its two casts asked alone make ${r2(engineTwo)} B`);
  // A sanity check beside (b)'s, with its slack: the hold on the mark's own code is (d)'s.
  ok(markShown && !!hitA && markOwn <= 1.1 * engineTwo + 2, `the mark, shown, makes ${r2(markOwn)} B a frame against the real engine, against ${r2(engineTwo)} B for its two casts asked alone (within 10%, plus 2 B)`);

  // (d) The hook's own code over whole frames, held to what the grapple's own arithmetic is held to in (a): the sway,
  // both reels, the haul and its lip-over, the drags, the constraint and its correction, the collider sync, the clip
  // and the wall it finds, the carry, the wrap's sweep and fan, the bend made at the lip, the anchor's check, and the
  // mark shown and held, with the engine's answers kept. Anything the hook itself makes in a frame shows there byte
  // for byte, where the whole path's bound in (b) is the engine's own variance wide. It runs in a node process of its
  // own (`grappleAllocOwn.ts`), because in this one every call site the hook makes has met the real engine as well
  // as the kept answers, and a call no longer built in boxes the numbers it hands over.
  watch.disconnect();
  const alone = JSON.parse(
    execFileSync(process.execPath, ['--expose-gc', '--allow-natives-syntax', fileURLToPath(new URL('./grappleAllocOwn.ts', import.meta.url))], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .pop() ?? '{}',
  ) as { frames: number; made: number; scavenges: number; seen: Record<string, number>; bentAtLip: boolean; attached: boolean; bends: number };
  const exercised = Object.entries(alone.seen ?? {}).filter(([, n]) => n === 0).map(([k]) => k);
  note(`in a process of its own, over one loop of the keys: ${JSON.stringify(alone.seen)}`);
  ok(alone.bentAtLip && alone.attached && alone.bends === 1 && exercised.length === 0, `the hook's whole frame, the engine's answers kept, bent at the lip, swayed, reeled both ways, hauled, went over the lip, met a wall, held taut and showed and held its mark, still attached at its bend (${exercised.join(', ') || 'nothing missed'})`);
  ok(alone.scavenges === 0 && alone.made < 0.2 * alone.frames, `and over ${alone.frames} such frames the hook's own code makes ${Math.max(0, alone.made)} bytes (under 0.2 B a frame, ${alone.scavenges} collections)`);
});

// =============================================================================================================
await section(18, 'on the ground with the hook in', async () => {
  const stand = async (fps: number) => {
    let wall: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      wall = box(p, [-25, 0, -20], [-20, 30, 20], true);
    });
    void wall;
    b.forward.set(-1, 0, 0);
    b.right.set(0, 0, -1);
    b.place(0, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.fireAt = { x: -20, y: b.pos.y + GRAPPLE_TUNE.ropeY, z: 0 };
    tap(b, 'Mouse3', 1 / fps);
    for (let i = 0; i < fps && !b.grapple.attached; i++) b.frame(1 / fps);
    return { physics, b };
  };
  for (const fps of FPS) {
    const dt = 1 / fps;
    let swungOnGround = 0;
    const watchGround = (b: TestBody) => {
      if (b.grounded && b.grapple.modes.swinging) swungOnGround++;
    };
    // W.
    {
      const { b } = await stand(fps);
      const d0 = handToPivot(b);
      const taut = Math.abs(b.grapple.rope.length - d0) < 0.01 && Math.abs(d0 - 19.95) < 0.05;
      b.key('KeyW', true);
      b.run(fps, 2, () => watchGround(b));
      b.key('KeyW', false);
      const closed = d0 - handToPivot(b);
      ok(taut && closed >= 5, `${fps} fps: fired from the ground at a wall 20 m off, the rope lands taut at ${r2(d0)} m, and W closes ${r2(closed)} m in 2 s (at least 5)`);
    }
    // D.
    {
      const { b } = await stand(fps);
      const x0 = b.pos.x;
      const z0 = b.pos.z;
      let airborne = 0;
      b.key('KeyD', true);
      b.run(fps, 2, () => {
        watchGround(b);
        if (!b.grounded) airborne++;
      });
      b.key('KeyD', false);
      const moved = Math.hypot(b.pos.x - x0, b.pos.z - z0);
      ok(moved >= 3 && airborne === 0, `${fps} fps: D moves ${r2(moved)} m round the anchor (at least 3) and never leaves the ground`);
    }
    // S.
    {
      const { b } = await stand(fps);
      let over = 0;
      let airborne = 0;
      b.key('KeyS', true);
      b.run(fps, 2, () => {
        watchGround(b);
        over = Math.max(over, handToPivot(b) - b.grapple.rope.free());
        if (!b.grounded) airborne++;
      });
      b.key('KeyS', false);
      ok(over <= 0.02 && airborne === 0, `${fps} fps: S holds the body ${r3(over * 100)} cm past the rope's length at most (within 2 cm), on the ground throughout`);
    }
    // Space, against a plain jump. `held` is how long Space stays down: one frame is a tap.
    {
      const jumpApex = async (hooked: boolean, level: number, held: number) => {
        const s = hooked ? await stand(fps) : null;
        let b: TestBody;
        if (s) b = s.b;
        else {
          const plain = await scene((p) => {
            ground(p, 0);
            box(p, [-25, 0, -20], [-20, 30, 20], true);
          });
          b = plain.b;
          b.forward.set(-1, 0, 0);
          b.place(0, 0.02, 0);
          plain.physics.stepOnce();
          b.run(fps, 0.3);
          for (let i = 0; i < fps; i++) b.frame(dt);
        }
        b.jka.forceLevel = level;
        const y0 = b.pos.y;
        let high = y0;
        b.key('Space', true);
        let landed = false;
        for (let i = 0; i < 4 * fps; i++) {
          b.frame(dt);
          if (i + 1 >= held * fps) b.key('Space', false);
          high = Math.max(high, b.pos.y);
          if (i > 5 && b.grounded) {
            landed = true;
            break;
          }
          watchGround(b);
        }
        b.key('Space', false);
        return { rise: high - y0, landed, attached: b.grapple.attached };
      };
      // Anybody but a Jedi (Force Jump 0, whose held jump is a tap's): Space held half a second with the line in is
      // the plain jump held as long.
      const plain0 = await jumpApex(false, 0, 0.5);
      const roped0 = await jumpApex(true, 0, 0.5);
      ok(Math.abs(roped0.rise - plain0.rise) <= 0.01 && roped0.landed && roped0.attached && plain0.rise > 0.5, `${fps} fps, Force 0: Space held jumps ${r3(roped0.rise)} m with the line in against a plain ${r3(plain0.rise)} m (within 1 cm), and lands still attached`);
      // A Jedi's tap is the plain tap.
      const tap3 = await jumpApex(false, 3, 0);
      const ropedTap3 = await jumpApex(true, 3, 0);
      ok(Math.abs(ropedTap3.rise - tap3.rise) <= 0.01 && ropedTap3.landed && ropedTap3.attached, `${fps} fps, Force 3: a tap jumps ${r3(ropedTap3.rise)} m with the line in against a plain tap's ${r3(tap3.rise)} m (within 1 cm), and lands still attached`);
      // A Jedi's held jump with the line in is the tap, by the design's own rule (§3.1, 1; research1 and research2):
      // off the ground on the rope the body is swinging, Space is the boost and the movement is handed no jump, so
      // the Force jump's hold never runs against the rope. The plain held jump beside it is the control, so the rule
      // is held here rather than merely survived; whether a Jedi should keep the hold on a slack line is the owner's.
      const held3 = await jumpApex(false, 3, 0.5);
      const ropedHeld3 = await jumpApex(true, 3, 0.5);
      ok(Math.abs(ropedHeld3.rise - ropedTap3.rise) <= 0.001 && held3.rise > tap3.rise + 0.5 && ropedHeld3.attached, `${fps} fps, Force 3: Space held half a second with the line in rises ${r3(ropedHeld3.rise)} m, its own tap's ${r3(ropedTap3.rise)} m (the Force jump's hold is not handed to the movement on the rope), where the plain held jump rises ${r3(held3.rise)} m`);
    }
    ok(swungOnGround === 0, `${fps} fps: swinging is false on every frame on the ground`);
  }
});

// =============================================================================================================
await section(19, 'landing with the line in', async () => {
  const land = async (fps: number, hooked: boolean) => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      beam = box(p, [-30.5, 30, -0.5], [-29.5, 31, 0.5], false);
    });
    b.place(0, 2, 0);
    physics.stepOnce();
    if (hooked) b.hook(-30, 30, 0, 0, -1, 0, beam as never, 80);
    b.vel.set(15, 0, 0);
    const dt = 1 / fps;
    let touch = Number.NaN;
    let latchInAir = false;
    let latchFirst = true;
    for (let i = 0; i < 6 * fps; i++) {
      b.frame(dt);
      if (Number.isNaN(touch) && !b.grounded && b.grapple.latch) latchInAir = true;
      if (Number.isNaN(touch) && b.grounded) {
        touch = b.pos.x;
        latchFirst = b.grapple.latch;
      }
      if (!Number.isNaN(touch) && Math.hypot(b.vel.x, b.vel.z) < 0.05) break;
    }
    return { stop: b.pos.x - touch, latchInAir, latchFirst };
  };
  for (const fps of FPS) {
    const plain = await land(fps, false);
    const roped = await land(fps, true);
    const off = Math.abs(roped.stop - plain.stop) / plain.stop;
    ok(off <= 0.05, `${fps} fps: landing at 15 m/s on a slack line stops in ${r2(roped.stop)} m against a plain ${r2(plain.stop)} m (within 5 %)`);
    ok(roped.latchInAir && !roped.latchFirst, `${fps} fps: the latch, set while it hung, is clear the first frame on the ground`);
  }
});

// =============================================================================================================
await section(20, 'a run is not a slide', async () => {
  const turn = async (fps: number, hooked: boolean) => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      beam = box(p, [-60.5, 40, -0.5], [-59.5, 41, 0.5], false);
    });
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(0, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    if (hooked) b.hook(-60, 40, 0, 0, -1, 0, beam as never, 100);
    b.speedScale = 2.1;
    let latched = 0;
    const each = () => {
      if (b.grapple.latch) latched++;
    };
    b.key('KeyW', true);
    b.run(fps, 2, each);
    const xTurn = b.pos.x;
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.run(fps, 2, each);
    b.key('KeyW', false);
    const over = b.pos.x - xTurn;
    // The latch is the run's to never set; the jump after it leaves the ground, and a body off it on a rope hangs.
    const runLatched = latched;
    const jumped = b.jumped;
    tap(b, 'Space', 1 / fps);
    b.run(fps, 0.1);
    return { over, jumpedNow: b.jumped > jumped, latched: runLatched, attached: b.grapple.attached };
  };
  for (const fps of FPS) {
    const plain = await turn(fps, false);
    const roped = await turn(fps, true);
    const off = Math.abs(roped.over - plain.over) / Math.max(1e-6, Math.abs(plain.over));
    ok(off <= 0.05 && roped.attached, `${fps} fps: with a slack rope in and Force Speed's 2.1, a run turned through 90 degrees carries on ${r3(roped.over)} m against ${r3(plain.over)} m without (within 5 %)`);
    ok(roped.jumpedNow && roped.latched === 0, `${fps} fps: the latch is never set through the run, and Space jumps`);
  }
});

// =============================================================================================================
await section(21, 'the gravity knob', async () => {
  // At 1 the add-back is never run: a âˆ’0 stays âˆ’0.
  {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beam = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
    });
    b.place(5, 20, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, beam as never, 40);
    GRAPPLE_TUNE.swingDrag = 0;
    b.grapple.refreshModes(b);
    b.vel.set(0, -0, 0);
    b.grapple.beforeMove(b, 1 / 60);
    const atOne = b.vel.y;
    GRAPPLE_TUNE.gravity = 0.6;
    b.vel.set(0, -0, 0);
    b.grapple.beforeMove(b, 1 / 60);
    const atSix = b.vel.y;
    ok(b.grapple.modes.swinging && Object.is(atOne, -0) && !Object.is(atSix, -0), `at the default of 1 a swinging body's vel.y of -0 stays -0 (the add-back is never run); at 0.6 it is ${r3(atSix)}`);
    fresh();
  }
  // A jump with a fire and a call-back lands where the plain jump lands.
  const jump = async (fps: number, fire: boolean, gravity: number) => {
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      box(p, [-92, 0, -50], [-90, 60, 50], true);
    });
    GRAPPLE_TUNE.gravity = gravity;
    b.forward.set(-1, 0, 0);
    b.place(0, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.fireAt = { x: -90, y: 5, z: 0 };
    const trace: number[] = [];
    const dt = 1 / fps;
    let fired = false;
    let recalled = false;
    let flew = false;
    for (let i = 0; i < 2 * fps; i++) {
      const t = i * dt;
      b.key('Space', t < 0.1);
      const fireNow = fire && !fired && t >= 0.15;
      const recallNow = fire && fired && !recalled && t >= 0.3;
      if (fireNow) fired = true;
      if (recallNow) recalled = true;
      b.key('Mouse3', fireNow || recallNow);
      b.frame(dt);
      b.key('Mouse3', false);
      if (b.grapple.flying) flew = true;
      trace.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z);
    }
    return { trace, flew, attachedEver: b.grapple.counts.bites > 0, off: b.grapple.state === 'off' };
  };
  for (const fps of FPS) {
    for (const gravity of [1, 0.6]) {
      const plain = await jump(fps, false, gravity);
      const fired = await jump(fps, true, gravity);
      let same = plain.trace.length === fired.trace.length;
      for (let i = 0; same && i < plain.trace.length; i++) if (!Object.is(plain.trace[i], fired.trace[i])) same = false;
      ok(same && fired.flew && !fired.attachedEver && fired.off, `${fps} fps, gravity ${gravity}: a jump with a fire and a call-back lands where the plain jump lands, every place by Object.is`);
    }
  }
  fresh();
});

// =============================================================================================================
await section(22, 'swaying along a wall', async () => {
  for (const fps of FPS) {
    let wall: unknown = null;
    const { physics, b } = await scene((p) => {
      wall = box(p, [-10, 0, -10], [0, 30, 10], true);
    });
    b.forward.set(-1, 0, 0);
    b.right.set(0, 0, -1);
    b.place(0.4, 25 - 10 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 25, 0, 1, 0, 0, wall as never, 10.01);
    b.run(fps, 1);
    const z0 = b.pos.z;
    b.key('KeyD', true);
    b.run(fps, 2);
    b.key('KeyD', false);
    const moved = Math.abs(b.pos.z - z0);
    ok(b.grapple.attached && moved >= 1.5, `${fps} fps: hanging against the wall, D sways the body ${r2(moved)} m along it in 2 s (at least 1.5)`);
  }
});

// =============================================================================================================
// 23. The chain: the rope's own path tracking (what the dart's bite runs) along the curved path the hand flew
// while the dart was in the air, against the chord from where it fired to where it is.
await section(23, 'the chain', async () => {
  const shot = async (curved: boolean) => {
    fresh();
    const physics = await makePhysics();
    box(physics, [-10, 0, -10], [0, 30, 0], true);
    const anchor = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setTranslation(-20, 15, 20.5));
    physics.stepOnce();
    const rope = new GrappleRope(RAPIER, physics.world, groups(Group.all, Group.all), null, GRAPPLE_TUNE);
    // The hand swung round the building's corner on a circle about its edge while the dart flew.
    const R = 8;
    const a0 = (-20 * Math.PI) / 180;
    const a1 = (170 * Math.PI) / 180;
    const trail: number[] = [];
    const steps = Math.ceil((R * (a1 - a0)) / GRAPPLE_TUNE.chord);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      trail.push(R * Math.sin(a), 15, R * Math.cos(a));
    }
    const n = trail.length / 3;
    const end = [trail[3 * n - 3], trail[3 * n - 2], trail[3 * n - 1]];
    rope.attach(-20, 15, 20, 0, 0, -1, anchor, trail[0], trail[1], trail[2]);
    if (curved) rope.trackPath(new Float64Array(trail), n - 1, { x: end[0], y: end[1], z: end[2] });
    else rope.track({ x: end[0], y: end[1], z: end[2] });
    let worst = 0;
    for (let j = 1; j <= rope.n; j++) worst = Math.max(worst, toLine(rope.contact[3 * j], rope.contact[3 * j + 1], rope.contact[3 * j + 2], 0, 0, 0, 0, 1, 0));
    return { n: rope.n, worst, fallbacks: rope.stats.fallbacks, blocked: rope.blockedNow(end[0], end[1], end[2]) };
  };
  const along = await shot(true);
  const chord = await shot(false);
  ok(along.n >= 1 && along.worst <= 1e-3 && along.fallbacks === 0 && along.blocked === 0, `tracked along the hand's curved path, every bend's contact is on the corner's edge (worst ${r3(along.worst * 1000)} mm), no plain-hit fallback, nothing blocked`);
  ok(chord.blocked > 0 || chord.fallbacks > 0, `swept along the chord instead, the same shot has ${chord.blocked} blocked span(s) and ${chord.fallbacks} fallback(s): the test sees the fault`);
});

// =============================================================================================================
await section(24, 'a teleport', async () => {
  for (const fps of FPS) {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beam = box(p, [-0.5, 30, -0.5], [0.5, 31, 0.5], false);
    });
    b.place(0, 30 - 0.05 - 10 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 30, 0, 0, -1, 0, beam as never, 10.01);
    b.run(fps, 0.5);
    const casts = b.grapple.rope.stats.casts;
    b.pos.x += 30;
    b.frame(1 / fps);
    ok(b.grapple.state === 'off' && b.grapple.lastLetGo === 'moved' && b.grapple.rope.stats.casts === casts, `${fps} fps: the hand moved 30 m in one frame, the rope lets go (${b.grapple.lastLetGo}) with no ray cast from the new place`);
  }
});

// =============================================================================================================
await section(25, 'the refusals', async () => {
  const stand = async () => {
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      box(p, [-25, 0, -20], [-20, 30, 20], true);
    });
    b.forward.set(-1, 0, 0);
    b.right.set(0, 0, -1);
    b.place(0, 0.02, 0);
    physics.stepOnce();
    b.run(60, 0.3);
    b.fireAt = { x: -20, y: 5, z: 0 };
    return b;
  };
  for (const [what, set] of [
    ['prone', (b: TestBody) => (b.prone = true)],
    ['kneeling', (b: TestBody) => (b.kneeling = true)],
    ['swg profile', (b: TestBody) => (b.moveProfile = 'swg')],
  ] as const) {
    const b = await stand();
    set(b);
    tap(b, 'Mouse3', 1 / 60);
    ok(b.grapple.state === 'off' && b.lastFireRefusal === what, `no dart is fired ${what === 'swg profile' ? "under the 'swg' profile" : `while ${what}`} (${b.lastFireRefusal})`);
  }
  {
    const b = await stand();
    b.key('KeyW', true);
    b.run(60, 0.4);
    tap(b, 'ControlLeft', 1 / 60);
    const rolling = b.jka.rolling;
    tap(b, 'Mouse3', 1 / 60);
    b.key('KeyW', false);
    ok(rolling && b.grapple.state === 'off' && b.lastFireRefusal === 'rolling', `no dart is fired while rolling (${b.lastFireRefusal})`);
  }
  ok(new TestBody(await makePhysics()).grapple.refusal({ ...newFireState(), special: true }) === 'special', 'no dart is fired in a special jump');
  // Owning a rig (wave 4): asked only once `everyone` is off, and then it is what lets a character fire.
  {
    const g = new TestBody(await makePhysics()).grapple;
    const was = GRAPPLE_TUNE.everyone;
    try {
      GRAPPLE_TUNE.everyone = true;
      ok(g.refusal({ ...newFireState(), rig: false }) === '' && g.refusal({ ...newFireState(), rig: true }) === '', 'with everyone carrying one for now, owning a rig changes nothing: with or without, the press fires');
      GRAPPLE_TUNE.everyone = false;
      ok(g.refusal({ ...newFireState(), rig: false }) === 'no rig', 'with that turned off, a character with no rig is refused');
      ok(g.refusal({ ...newFireState(), rig: true }) === '', 'and one who owns a rig fires');
      ok(g.refusal({ ...newFireState(), rig: true, mounted: true }) === 'mounted', 'owning one refuses nothing the rest would not');
    } finally {
      GRAPPLE_TUNE.everyone = was;
    }
  }
  {
    const b = await stand();
    tap(b, 'Mouse3', 1 / 60);
    ok(b.grapple.state === 'flying', 'with nothing refusing it, the press fires');
  }
  // Swimming, at the surface and under it.
  for (const deep of [false, true]) {
    const { physics, b } = await scene((p) => {
      for (const ox of [-64, 0]) for (const oz of [-64, 0]) heightChunk(p, ox, oz, () => -10);
      box(p, [-25, -10, -20], [-20, 30, 20], true);
    });
    b.surface = () => 0;
    b.place(0, deep ? -4 : -1.25, 0);
    physics.stepOnce();
    b.frame(1 / 60);
    const swimming = b.swimming;
    const under = b.submerged;
    b.fireAt = { x: -20, y: deep ? -3 : 3, z: 0 };
    tap(b, 'Mouse3', 1 / 60);
    ok(swimming && under === deep && b.grapple.out, `a dart is fired while swimming ${deep ? 'under the water' : 'at the surface'} (${b.grapple.state})`);
  }
});

// =============================================================================================================
await section(26, 'the key order', async () => {
  const press = async (fps: number, hooks: boolean) => {
    let wall: unknown = null;
    const { physics, b } = await scene((p) => {
      wall = box(p, [-10, 0, -10], [0, 40, 10], true);
    });
    b.jka.forceLevel = 3;
    b.forward.set(-1, 0, 0);
    b.right.set(0, 0, -1);
    b.place(0.4, 30 - 8 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 30, 0, 1, 0, 0, wall as never, 8.01);
    b.run(fps, 0.5);
    b.key('KeyW', true);
    b.run(fps, 0.1);
    b.hooks = hooks;
    const muted: boolean[] = [];
    b.key('Space', true);
    b.run(fps, 0.5, () => muted.push(b.input.muted('jump')));
    b.key('Space', false);
    b.frame(1 / fps);
    const after = b.input.muted('jump');
    b.key('KeyW', false);
    return { specials: b.specials.length, why: b.grapple.lastLetGo, muted, after };
  };
  for (const fps of FPS) {
    const hooked = await press(fps, true);
    const control = await press(fps, false);
    ok(hooked.why === 'boost' && hooked.muted.every(Boolean) && !hooked.after, `${fps} fps: on the boost's frame the jump is muted before the boost acts and stays muted while Space is held, and not after`);
    ok(hooked.specials === 0 && control.specials > 0, `${fps} fps: a Force 3 Jedi beside a wall who boosts starts no wall move (${hooked.specials}), where the same press with the hook's keys skipped starts one (${control.specials})`);
  }
});

// =============================================================================================================
await section(27, 'a real crest', async () => {
  const { groundWorlds, PACKS } = await import('./terrainHarness.ts');
  const worlds = groundWorlds();
  if (!worlds.length) {
    note(`skip a real crest: no converted worlds under ${PACKS}`);
    return;
  }
  const { SwgTerrain } = await import('../../../src/world/swgTerrain.ts');
  const { Terrain, chunkHeightfield, CHUNK_SIZE } = await import('../../../src/world/terrain.ts');
  const world = worlds.includes('naboo') ? 'naboo' : worlds[0];
  const dir = join(PACKS, world);
  const layout = join(dir, 'layout.json');
  const m = existsSync(layout) ? /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(layout, 'utf8').slice(0, 8000)) : null;
  if (!m) {
    note(`skip a real crest: ${world} has no layout centre`);
    return;
  }
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const bb = readFileSync(f);
    return bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength) as ArrayBuffer;
  };
  const swg = await SwgTerrain.create(bytes('terrain.trn')!, [], Number(m[1]), Number(m[2]), async (file: string) => bytes(file));
  const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as never;
  const terrain = new Terrain(planet);
  terrain.attachSwg(swg);
  // The roundest crest near the world's middle: the highest point over the mean of its neighbours 12 m off.
  let best = { score: -Infinity, x: 0, z: 0, dx: 1, dz: 0 };
  for (let x = -300; x <= 300; x += 6) {
    for (let z = -300; z <= 300; z += 6) {
      const h = terrain.heightAt(x, z);
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ]) {
        const a = terrain.heightAt(x - 12 * dx, z - 12 * dz);
        const c = terrain.heightAt(x + 12 * dx, z + 12 * dz);
        const score = Math.min(h - a, h - c);
        if (score > best.score) best = { score, x, z, dx, dz };
      }
    }
  }
  const physics = await makePhysics();
  const cx0 = Math.floor(best.x / CHUNK_SIZE);
  const cz0 = Math.floor(best.z / CHUNK_SIZE);
  for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) for (let cz = cz0 - 1; cz <= cz0 + 1; cz++) chunkHeightfield(physics, terrain.buildChunk(cx, cz));
  physics.stepOnce();
  fresh();
  const rope = new GrappleRope(RAPIER, physics.world, groups(Group.all, Group.all), null, GRAPPLE_TUNE);
  const top = terrain.heightAt(best.x, best.z);
  const ax = best.x - 20 * best.dx;
  const az = best.z - 20 * best.dz;
  const ay = terrain.heightAt(ax, az);
  // Laid over the crest (the hand let down the far side from above it), then dragged sideways round the anchor 75
  // degrees, the hand half a metre over the ground 40 m from the anchor: the contact rides along the rounded
  // shoulder, a ground bend at each crease.
  const steps: number[][] = [];
  const far = (h: number) => [best.x + 20 * best.dx, h, best.z + 20 * best.dz];
  const groundAt = (x: number, z: number) => terrain.heightAt(x, z) + 0.5;
  const f0 = far(top + 15);
  const fy = groundAt(f0[0], f0[2]);
  for (let y = f0[1]; y > fy; y -= GRAPPLE_TUNE.chord) steps.push([f0[0], y, f0[2]]);
  const R = 40;
  const arcSteps = Math.ceil((R * (75 * Math.PI)) / 180 / GRAPPLE_TUNE.chord);
  for (let i = 0; i <= arcSteps; i++) {
    const t = ((75 * Math.PI) / 180) * (i / arcSteps);
    const dx = best.dx * Math.cos(t) - best.dz * Math.sin(t);
    const dz = best.dx * Math.sin(t) + best.dz * Math.cos(t);
    const x = ax + R * dx;
    const z = az + R * dz;
    steps.push([x, groundAt(x, z), z]);
  }
  rope.attach(ax, ay, az, 0, 1, 0, null, f0[0], f0[1], f0[2]);
  let blocked = 0;
  let most = 0;
  for (const h of steps) {
    rope.track({ x: h[0], y: h[1], z: h[2] });
    most = Math.max(most, rope.groundBends);
    if (rope.blockedNow(h[0], h[1], h[2]) > 0) blocked++;
    if (rope.fouled) break;
  }
  note(`${world}: crest at (${best.x}, ${best.z}), ${r2(best.score)} m over its neighbours 12 m off; dragged 75 degrees over it the rope made ${rope.stats.groundWraps} ground bends, held ${most} at once (cap ${GRAPPLE_TUNE.maxGroundWraps}) and ${rope.thingBends} on things`);
  ok(blocked === 0 && !rope.fouled && rope.thingBends === 0 && rope.stats.groundWraps > 0, `${world}: a rope dragged 75 degrees over a real crest keeps no blocked span (${blocked}), counts its ${rope.stats.groundWraps} ground bends apart from the trunk cap (${most} at once), and does not foul`);
});

// =============================================================================================================
// =============================================================================================================
// 28. The slab (`opposedLean`). A rope draped over a 3 m slab with the hand swept to straight under it, in the
// default quarter-metre pieces and in one piece a frame (`chord` 100, as a hull flown across a rope sweeps it), keeps
// no blocked span on any frame. What a still world cannot do is show the old rule failing on a path a body can take:
// a search over 1.67 million drapes of this slab (anchors on it and over it, the hand carried from beside it to under
// it in one, two and three steps, both chords, every path a capsule could move along without entering it) met
// opposed faces in 977,061 of them and found a blocked span under neither rule, because a still pivot never carries
// the sweep along the first face; the hull flown across a rope does, and W3's hull tests carry that control. So the
// rule is held here two ways that can fail: the placement itself, branch by branch, through the very function the
// rope calls (`bendOffsetDir`); and a drape whose hand is carried past the slab's edge a hair inside it (1.6 cm, which
// a capsule never is, but to the rope the hand is a point), where the old rule leaves a span blocked and this one does
// not.
await section(28, 'the slab', async () => {
  const io = new Float64Array(10);
  const out = { x: 0, y: 0, z: 0 };
  const dir = (n1: number[], n2: number[], s: number[], farPlane: number, opposed: boolean) => {
    io.set([...n1, ...n2, ...s, farPlane]);
    bendOffsetDir(io, { ...GRAPPLE_DEFAULTS, opposedLean: opposed }, out);
    return { x: out.x, y: out.y, z: out.z };
  };
  const dot = (a: { x: number; y: number; z: number }, b: number[]) => a.x * b[0] + a.y * b[1] + a.z * b[2];
  // The slab's top met first, its bottom from the far end, 0.3 m apart; the sweep runs along the top, across the edge.
  const top = [0, 1, 0];
  const bottom = [0, -1, 0];
  const along = [0, 0, -0.25];
  const lean = dir(top, bottom, along, 0.3, true);
  const old = dir(top, bottom, along, 0.3, false);
  ok(dot(lean, top) > 0.5 && dot(lean, along) < 0 && Math.abs(Math.hypot(lean.x, lean.y, lean.z) - 1) < 1e-12, `opposed faces two planes apart: the bend stands off the first face (${r3(dot(lean, top))}) and back along the sweep`);
  ok(Math.abs(dot(old, top)) < 1e-12 && dot(old, along) < 0, `with opposedLean off it stands back along the sweep alone, at the edge's own height (${r3(dot(old, top))} off the first face): the rule is what lifts it`);
  // One face met from both sides (a heightfield's cliff, grazed from its plateau): the far plane is the contact's own,
  // and the bend goes back along the sweep, never off the back face into the ground the ridge tops.
  const graze = dir(top, bottom, along, 0, true);
  ok(Math.abs(dot(graze, top)) < 1e-12 && dot(graze, along) < 0, `one face met from both sides (far plane 0): back along the sweep, the rule standing aside`);
  // The other two branches, for completeness: faces that agree lean back along the sweep, and an edge takes the bisector.
  const round = dir(top, top, along, 0, true);
  ok(dot(round, top) > 0 && dot(round, along) < 0, 'faces that agree: the one normal, leaned back along the sweep');
  const edge = dir(top, [1, 0, 0], along, 0.5, true);
  ok(Math.abs(edge.x - Math.SQRT1_2) < 1e-12 && Math.abs(edge.y - Math.SQRT1_2) < 1e-12 && edge.z === 0, 'an edge between two faces: off along their bisector');

  const drape = async (opposed: boolean, path: number[][], whole: boolean, anchorX = -1.2) => {
    fresh();
    GRAPPLE_TUNE.opposedLean = opposed;
    if (whole) GRAPPLE_TUNE.chord = 100;
    const physics = await makePhysics();
    const slab = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 0.15, 2).setTranslation(0, 20.15, 0));
    physics.stepOnce();
    const rope = new GrappleRope(RAPIER, physics.world, groups(Group.all, Group.all), null, GRAPPLE_TUNE);
    let opposedMet = 0;
    rope.onBend = (e) => {
      if (e.n1 && e.n2 && e.n1[0] * e.n2[0] + e.n1[1] * e.n2[1] + e.n1[2] * e.n2[2] < -0.9) opposedMet++;
    };
    rope.attach(anchorX, 20.3, 0, 0, 1, 0, slab, path[0][0], path[0][1], path[0][2]);
    let blocked = 0;
    for (let i = 1; i < path.length; i++) {
      rope.track({ x: path[i][0], y: path[i][1], z: path[i][2] });
      if (rope.blockedNow(path[i][0], path[i][1], path[i][2]) > 0) blocked++;
    }
    return { blocked, opposedMet, n: rope.n };
  };
  for (const whole of [false, true]) {
    for (const steps of [1, 2, 3, 12]) {
      const path: number[][] = [];
      for (let i = 0; i <= steps; i++) path.push([4 - (4 * i) / steps, 22 - (10 * i) / steps, 0]);
      const on = await drape(true, path, whole);
      ok(on.blocked === 0 && on.n >= 1, `draped over a 3 m slab, the hand swept to straight under it in ${steps} frame(s) ${whole ? 'in one piece each' : 'in quarter-metre pieces'}: no frame with a blocked span (${on.n} bends, opposed faces met ${on.opposedMet} times)`);
    }
  }
  // The control: the hand from beside the slab's edge to under it in one frame, its path inside the edge by 1.6 cm.
  const cut = [
    [1.7, 20.5, 0],
    [0.5, 18, 1.5],
  ];
  const on = await drape(true, cut, false, -1.4);
  const off = await drape(false, cut, false, -1.4);
  ok(on.blocked === 0 && off.blocked > 0 && on.opposedMet > 0, `the hand carried past the edge a hair inside it: ${off.blocked} blocked span with the old rule (${off.n} bends), none with opposedLean (${on.n} bends, opposed faces met ${on.opposedMet} times): the test sees the fault`);
  fresh();
});

// =============================================================================================================
// Wave 2: the danger (30, 31), the sound (32), and the look (33, 34), and nothing of any of it for a body that
// never fires (35).
await section(30, 'the slam', async () => {
  // A swing from rest into a wall at the bottom (the design's §3.11 table): the beam 40 m up, a wall whose face stands
  // 1.2 m past the swing's bottom.
  const swing = async (fps: number, L: number, fromDeg: number) => {
    let top: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      top = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
      box(p, [-3, 0, -10], [-1.2, 60, 10], false);
    });
    const th = (fromDeg * Math.PI) / 180;
    b.place(L * Math.sin(th), 39.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, top as never, L);
    let staggered = 0;
    b.run(fps, 4, () => {
      if (b.grapple.staggered) staggered++;
    });
    return { b, staggered };
  };
  for (const fps of FPS) {
    const lv = await swing(fps, 20, 90);
    const s = lv.b.grapple.lastSlam;
    const harm = lv.b.harms.length ? lv.b.harms[0].amount : -1;
    ok(lv.b.harms.length === 1 && lv.b.grapple.counts.slams === 1 && harm === slamHarm(s.speed, 100, GRAPPLE_TUNE) && Math.abs(harm - 35) <= 2 && s.kind === 'swing' && s.took && lv.b.harms[0].kind === 'fall', `${fps} fps: 20 m from level into a wall at ${r2(s.speed)} m/s: one harm of ${harm} (slamHarm of the speed, within 2 of 35), as a fall's`);
    ok(lv.staggered > 0 && lv.b.hp === 100 - harm && lv.b.grapple.attached, `${fps} fps: and it staggers (${lv.staggered} frames), the rope holding through it`);
    const sx = await swing(fps, 20, 60);
    const h6 = sx.b.harms.length ? sx.b.harms[0].amount : -1;
    ok(sx.b.harms.length === 1 && Math.abs(h6 - 9) <= 2 && h6 === slamHarm(sx.b.grapple.lastSlam.speed, 100, GRAPPLE_TUNE) && sx.staggered === 0, `${fps} fps: from 60 degrees on 20 m, ${r2(sx.b.grapple.lastSlam.speed)} m/s costs ${h6} (within 2 of 9) and no stagger`);
  }
  // Hanging off a ledge: stepping off a 20 m roof on 8 m of rope meets the wall at 12 m/s or so, which is free.
  for (const fps of FPS) {
    let bld: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      bld = box(p, [-10, 0, -10], [0, 20, 10], true);
    });
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(-0.6, 20, 0);
    physics.stepOnce();
    b.run(fps, 0.3);
    b.hook(-4, 20, 0, 0, 1, 0, bld as never, 12);
    b.key('KeyW', true);
    b.run(fps, 6, (t) => {
      if (t >= 0.6) b.key('KeyW', false);
    });
    ok(b.harms.length === 0 && b.grapple.maxImpact > 5 && b.grapple.maxImpact < GRAPPLE_TUNE.slamFrom, `${fps} fps: hanging off a ledge costs nothing (it met the wall at ${r2(b.grapple.maxImpact)} m/s)`);
  }
  // Pressed against a wall for 5 s, the sway held into it: nothing after the first contact, and here nothing at all.
  for (const fps of FPS) {
    let wall: unknown = null;
    const { physics, b } = await scene((p) => {
      wall = box(p, [-10, 0, -10], [0, 30, 10], true);
    });
    b.forward.set(-1, 0, 0);
    b.right.set(0, 0, -1);
    b.place(0.4, 25 - 10 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 25, 0, 1, 0, 0, wall as never, 10.01);
    b.key('KeyW', true);
    b.run(fps, 5);
    b.key('KeyW', false);
    ok(b.harms.length === 0 && b.grapple.counts.slams === 0, `${fps} fps: pressed against the wall it hangs on for 5 s, the sway held into it: no harm (the hardest contact ${r2(b.grapple.maxImpact)} m/s)`);
  }
  // The haul's own push never slams. With the arrival on (as it ships) the haul's steps stop at minFree and nothing after
  // meets the face fast (test 14); so the rule is proved with the arrival off, where the haul's own 18 m/s, still pointed
  // at the face, meets it the frame after it ends: with F still held it is the haul's push and costs nothing; let go of
  // the same frame it ends, the same contact is a slam (the test sees the fault).
  const haulAt = async (fps: number, arrive: boolean, letGoOnEnd: boolean) => {
    let wall: unknown = null;
    const { physics, b } = await scene((p) => {
      wall = box(p, [-3, -10, -10], [-1.2, 30, 10], true);
    });
    GRAPPLE_TUNE.haulArrive = arrive;
    // In the air, so no ground's friction takes the haul's speed off before it meets the face.
    b.place(14, 5, 0);
    physics.stepOnce();
    // Level with the hand, so the haul runs straight at the face.
    b.hook(-1.2, b.pos.y + GRAPPLE_TUNE.ropeY, 0, 1, 0, 0, wall as never);
    b.key('KeyF', true);
    let measured = 0;
    let staggered = false;
    for (let i = 0; i < 3 * fps && b.grapple.attached; i++) {
      b.frame(1 / fps);
      // The haul's last step has brought the hand to the shortest: F let go before the next frame reads it.
      if (letGoOnEnd && b.grapple.hauling && handToPivot(b) <= GRAPPLE_TUNE.minFree + 0.01) b.key('KeyF', false);
      measured = Math.max(measured, b.grapple.lastImpact);
      if (b.grapple.staggered) staggered = true;
    }
    b.key('KeyF', false);
    return { b, measured, staggered, slam: { ...b.grapple.lastSlam } };
  };
  for (const fps of FPS) {
    const held = await haulAt(fps, false, false);
    ok(held.measured > GRAPPLE_TUNE.slamFrom && held.slam.kind === 'haul' && held.b.harms.length === 0 && !held.staggered, `${fps} fps: arrival off, F held: the haul's own speed meets the face at ${r2(held.measured)} m/s, measured as the haul's (${held.slam.kind}) and costing nothing, no stagger`);
    const loose = await haulAt(fps, false, true);
    ok(loose.b.harms.length === 1 && loose.slam.kind === 'swing', `${fps} fps: let go of F as the haul's last step lands, the same contact (${r2(loose.slam.speed)} m/s) is a slam of ${loose.b.harms[0]?.amount ?? 0}: the test sees the fault`);
    const ships = await haulAt(fps, true, false);
    ok(ships.b.harms.length === 0 && ships.measured <= 5, `${fps} fps: as it ships, the haul arrives at rest and the face is met at ${r2(ships.measured)} m/s, nothing`);
  }
  // A floor is not a wall: a let-go at 25 m/s straight down onto flat ground costs only its fall harm.
  for (const fps of FPS) {
    const drop = async (rope: boolean) => {
      let top: unknown = null;
      const { physics, b } = await scene((p) => {
        ground(p, 0);
        top = box(p, [-0.5, 60, -0.5], [0.5, 61, 0.5], false);
      });
      b.jka.forceLevel = 0;
      b.place(0, 10, 0);
      physics.stepOnce();
      if (rope) b.hook(0, 60, 0, 0, -1, 0, top as never, 100);
      b.vel.set(0, -25, 0);
      if (rope) b.grapple.letGo('fire');
      const released = b.grapple.released;
      let landed = -1;
      for (let i = 0; i < 3 * fps && landed < 3; i++) {
        b.frame(1 / fps);
        if (b.grounded) landed++;
      }
      return { b, released };
    };
    const r = await drop(true);
    const plain = await drop(false);
    // The landing is measured as a floor's where the controller reports the contact (at 144 fps its snap lands the body
    // with none to report); either way it is never a slam.
    const kind = r.b.grapple.lastSlam.kind;
    ok(r.released && r.b.harms.length === 0 && r.b.grapple.counts.slams === 0 && (kind === 'floor' || kind === '') && r.b.fallDamage === plain.b.fallDamage && r.b.fallDamage > 0, `${fps} fps: let go at 25 m/s down onto flat ground (in the fast flight), it lands ${kind === 'floor' ? `at ${r2(r.b.grapple.lastSlam.speed)} m/s on a floor` : 'with no contact to measure'}: nothing from the slam, ${r.b.fallDamage} from the fall as a plain fall costs ${plain.b.fallDamage}`);
  }
  // The fast flight after a let-go: a body let go of at 30 m/s 2 m short of a wall still strikes it and pays.
  const flight = async (fps: number, vx: number, vy: number, attachedAtHit = false) => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beam = box(p, [49.5, 20, -0.5], [50.5, 21, 0.5], false);
      box(p, [-3, -10, -10], [-1.2, 30, 10], false);
    });
    b.place(-1.2 + 0.35 + 2, 5, 0);
    physics.stepOnce();
    b.hook(50, 20, 0, -1, 0, 0, beam as never, 100);
    b.vel.set(vx, vy, 0);
    if (!attachedAtHit) b.grapple.letGo('fire');
    return { physics, b };
  };
  for (const fps of FPS) {
    const { b } = await flight(fps, -30, 0);
    const released = b.grapple.released;
    let staggered = false;
    b.run(fps, 0.4, () => {
      if (b.grapple.staggered) staggered = true;
    });
    const s = b.grapple.lastSlam;
    ok(released && b.harms.length === 1 && s.kind === 'released' && b.harms[0].amount === slamHarm(s.speed, 100, GRAPPLE_TUNE) && staggered, `${fps} fps: let go at 30 m/s 2 m short of a wall, the flight strikes it at ${r2(s.speed)} m/s for ${b.harms[0]?.amount ?? 0} and staggers`);
    // Let go at 10 m/s: never released, and nothing of the hook runs on the frames after.
    const slow = await flight(fps, -10, 0);
    const sb = slow.b;
    let clips = 0;
    let syncs = 0;
    const clip = sb.grapple.clip.bind(sb.grapple);
    const sync = sb.grapple.syncCollider.bind(sb.grapple);
    sb.grapple.clip = (x) => {
      clips++;
      clip(x);
    };
    sb.grapple.syncCollider = (x) => {
      syncs++;
      sync(x);
    };
    sb.run(fps, 0.5);
    ok(!sb.grapple.released && clips === 0 && syncs === 0 && sb.harms.length === 0, `${fps} fps: let go at 10 m/s, the flight is never released and neither the clip nor the sync runs on the frames after (${clips}, ${syncs})`);
    // Let go rising at 20 m/s in open air: released, and ended once gravity has it under slamFrom.
    const up = await flight(fps, 0, 20);
    let endedAt = -1;
    let speedThen = 0;
    up.b.run(fps, 1, (t) => {
      if (endedAt < 0 && !up.b.grapple.released) {
        endedAt = t;
        speedThen = up.b.vel.length();
      }
    });
    ok(endedAt > 0 && speedThen <= GRAPPLE_TUNE.slamFrom + 1e-9 && speedThen > GRAPPLE_TUNE.slamFrom - (G + 1) / fps, `${fps} fps: let go rising at 20 m/s, the flight ends ${r3(endedAt)} s on, at ${r2(speedThen)} m/s, the first frame under slamFrom`);
  }
  // slamKill: driven into a wall at 55 m/s on the rope, the whole of the health goes, and last stand leaves one point.
  for (const fps of FPS) {
    for (const stand of [false, true]) {
      const { b } = await flight(fps, -55, 0, true);
      b.lastStand = stand;
      b.run(fps, 0.2);
      const s = b.grapple.lastSlam;
      ok(s.speed >= GRAPPLE_TUNE.slamKill && b.harms.length === 1 && b.harms[0].amount === 100 && b.hp === (stand ? 1 : 0), `${fps} fps: into a wall at ${r2(s.speed)} m/s on the rope${stand ? ' under last stand' : ''}: ${b.harms[0]?.amount} harm, ${b.hp} left`);
    }
  }
  // A slam hurts at most once in slamGap. Let go at 30 m/s across a corner, the flight strikes one wall and, a tenth of a
  // second on, the other, both past slamFrom: only the first costs. With the gap at nought the same run costs twice (the
  // test sees the fault).
  const corner = async (fps: number, slamGap = GRAPPLE_DEFAULTS.slamGap) => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beam = box(p, [49.5, 20, 49.5], [50.5, 21, 50.5], false);
      // Two walls meeting at (-1.2, -1.2): one facing +x, one facing +z.
      box(p, [-3, -10, -10], [-1.2, 30, 10], false);
      box(p, [-10, -10, -3], [10, 30, -1.2], false);
    });
    GRAPPLE_TUNE.slamGap = slamGap;
    // Half a metre from the first wall and three from the second.
    b.place(-1.2 + 0.35 + 0.5, 5, -1.2 + 0.35 + 3);
    physics.stepOnce();
    b.hook(50, 20, 50, 0, -1, 0, beam as never, 100);
    const v = 30 / Math.SQRT2;
    b.vel.set(-v, 0, -v);
    b.grapple.letGo('fire');
    // Every contact the clip measured past slamFrom, read on the frames the clip ran (once the flight ends it runs no more,
    // and its last measure stands).
    const hits: number[] = [];
    const released = b.grapple.released;
    let t = 0;
    const clip = b.grapple.clip.bind(b.grapple);
    b.grapple.clip = (x) => {
      clip(x);
      if (b.grapple.lastImpact > GRAPPLE_TUNE.slamFrom) hits.push(t);
    };
    for (let i = 0; i < Math.round(0.6 * fps); i++) {
      t = (i + 1) / fps;
      b.frame(1 / fps);
    }
    return { b, hits, released };
  };
  for (const fps of FPS) {
    const c = await corner(fps);
    const gap = c.hits.length >= 2 ? c.hits[1] - c.hits[0] : -1;
    ok(c.released && c.hits.length === 2 && gap > 0 && gap < GRAPPLE_TUNE.slamGap && c.b.harms.length === 1 && c.b.grapple.counts.slams === 1 && c.b.harms[0].amount === slamHarm(c.b.grapple.lastSlam.speed, 100, GRAPPLE_TUNE), `${fps} fps: across a corner the flight strikes two walls past slamFrom ${r3(gap)} s apart (inside slamGap ${GRAPPLE_TUNE.slamGap}): one harm of ${c.b.harms[0]?.amount ?? 0}, not two`);
    const open = await corner(fps, 0);
    fresh();
    ok(open.hits.length === 2 && open.b.harms.length === 2, `${fps} fps: with the gap at nought the same flight costs ${open.b.harms.length} harms (the test sees the fault)`);
  }
  // The gap's clock runs whatever else of the hook is still: a slam from the console on a body with nothing out and too
  // slow to stagger, then another inside the gap (nothing) and another after it (it costs). The gap's clock is the hook's
  // `look`, which runs while the gap does; before, nothing else being lively, the gap stood shut for good.
  for (const fps of FPS) {
    const { physics, b } = await scene((p) => ground(p, 0));
    b.place(0, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.2);
    const first = b.grapple.slamAt(b, 20, 'console', 0, 1, -1);
    const staggeredByFirst = b.grapple.staggered;
    const inGap = b.grapple.slamAt(b, 25, 'console', 0, 1, -1);
    const livelyInGap = b.grapple.lively;
    let livelyAfter = true;
    b.run(fps, 0.5, () => {
      livelyAfter = b.grapple.lively;
    });
    const after = b.grapple.slamAt(b, 25, 'console', 0, 1, -1);
    ok(first === slamHarm(20, 100, GRAPPLE_TUNE) && first > 0 && !staggeredByFirst && inGap === 0 && livelyInGap && !livelyAfter, `${fps} fps: with nothing out, a slam at 20 m/s costs ${first} and no stagger, another inside the gap nothing, and once the gap has run nothing of the hook is left to step`);
    ok(after === slamHarm(25, 100, GRAPPLE_TUNE) && after > 0 && b.harms.length === 2, `${fps} fps: and a slam at 25 m/s after the gap costs ${after} again`);
  }
  fresh();
});

// =============================================================================================================
await section(31, 'the stagger', async () => {
  for (const fps of FPS) {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beam = box(p, [-0.5, 30, -0.5], [0.5, 31, 0.5], false);
    });
    b.place(4, 30 - 0.05 - 10 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 30, 0, 0, -1, 0, beam as never, 12);
    b.run(fps, 0.5);
    b.grapple.staggerNow();
    const len0 = b.grapple.rope.length;
    b.key('ShiftLeft', true);
    let reeledWhileStaggered = false;
    let staggerFrames = 0;
    let dazePeak = 0;
    let shakeFirst = -1;
    for (let i = 0; i < Math.round(0.45 * fps); i++) {
      b.frame(1 / fps);
      if (b.grapple.staggered) {
        staggerFrames++;
        if (b.grapple.keys.reelIn) reeledWhileStaggered = true;
      }
      dazePeak = Math.max(dazePeak, b.grapple.dazeNow);
      if (shakeFirst < 0) shakeFirst = b.grapple.shakeNow;
    }
    const lenStaggered = b.grapple.rope.length;
    b.run(fps, 0.3);
    b.key('ShiftLeft', false);
    ok(!reeledWhileStaggered && Math.abs(lenStaggered - len0) < 1e-9 && b.grapple.rope.length < len0 - 0.5, `${fps} fps: while it staggers (${staggerFrames} frames) the reel is refused, and after it the held reel winds in (${r2(len0 - b.grapple.rope.length)} m)`);
    ok(Math.abs(dazePeak - GRAPPLE_TUNE.daze) < 0.05 && shakeFirst > 0 && shakeFirst <= GRAPPLE_TUNE.shake && b.harms.length === 0, `${fps} fps: the daze peaks at ${r3(dazePeak)} (the tune's ${GRAPPLE_TUNE.daze}), the shake starts at ${r3(shakeFirst)}, and the console's stagger costs nothing`);
    ok(b.grapple.dazeNow === 0 && b.grapple.shakeNow === 0 && !b.grapple.staggered, `${fps} fps: and both are nought once it has run out`);
    // Space during a stagger boosts nothing; after it, it boosts and lets go.
    b.grapple.staggerNow();
    tap(b, 'Space', 1 / fps);
    const heldThrough = b.grapple.attached;
    b.run(fps, 0.6);
    tap(b, 'Space', 1 / fps);
    ok(heldThrough && b.grapple.state === 'off' && b.grapple.lastLetGo === 'boost', `${fps} fps: Space while staggered is no boost (still on the rope), and after the stagger it boosts off (${b.grapple.lastLetGo})`);
  }
  // The sway and the haul are refused while it staggers too. Hanging still under a beam, W held through a stagger pushes
  // nothing across the rope and F hauls nothing; once it has run out, the same keys sway and haul.
  for (const fps of FPS) {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beam = box(p, [-0.5, 30, -0.5], [0.5, 31, 0.5], false);
    });
    b.forward.set(1, 0, 0);
    b.right.set(0, 0, 1);
    b.place(0, 30 - 0.05 - 12 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 30, 0, 0, -1, 0, beam as never, 12);
    b.run(fps, 0.5);
    const dt = 1 / fps;
    // The sway: the speed along W's way.
    b.grapple.staggerNow();
    b.key('KeyW', true);
    let swayStaggered = 0;
    while (b.grapple.staggered) {
      b.frame(dt);
      swayStaggered = Math.max(swayStaggered, Math.abs(b.vel.x));
    }
    b.run(fps, 0.3);
    const swayAfter = Math.abs(b.vel.x);
    b.key('KeyW', false);
    ok(b.grapple.modes.swinging && swayStaggered < 0.05 && swayAfter > 1, `${fps} fps: W held while it staggers pushes nothing across the rope (${r3(swayStaggered)} m/s), and after it sways the body (${r2(swayAfter)} m/s)`);
    // The haul: F held through a stagger hauls nothing and takes no rope in; after it, it hauls.
    b.grapple.letGo('console');
    b.place(0, 30 - 0.05 - 12 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 30, 0, 0, -1, 0, beam as never, 12);
    b.run(fps, 0.5);
    b.grapple.staggerNow();
    const len0 = b.grapple.rope.length;
    b.key('KeyF', true);
    let hauledStaggered = false;
    while (b.grapple.staggered) {
      b.frame(dt);
      if (b.grapple.hauling || b.grapple.keys.haul) hauledStaggered = true;
    }
    const lenStaggered = b.grapple.rope.length;
    let hauledAfter = false;
    b.run(fps, 0.3, () => {
      if (b.grapple.hauling) hauledAfter = true;
    });
    b.key('KeyF', false);
    ok(!hauledStaggered && Math.abs(lenStaggered - len0) < 1e-9 && hauledAfter && b.grapple.rope.length < len0 - 2, `${fps} fps: F held while it staggers hauls nothing (the rope stays ${r2(lenStaggered)} m), and after it hauls (${r2(b.grapple.rope.length)} m)`);
  }
});

// =============================================================================================================
await section(32, 'the ratchet and the sounds', async () => {
  const prepared: string[] = [];
  const played: { id: string; pitch: number; loop: boolean; key: number }[] = [];
  const stopped: { key: number; fade: number | undefined }[] = [];
  let nextKey = 1;
  const host = {
    bank: { available: true, template: (_id: string) => ({ category: 7, priority: 3, full: 12 }), offer: () => {} },
    play: (id: string, o?: { pitch?: number }) => {
      played.push({ id, pitch: o?.pitch ?? 0, loop: false, key: nextKey });
      return nextKey++;
    },
    loop: (id: string) => {
      played.push({ id, pitch: 0, loop: true, key: nextKey });
      return nextKey++;
    },
    stop: (key: number, fade?: number) => void stopped.push({ key, fade }),
    setGain: () => {},
    isPlaying: () => true,
    prepare: (ids: Iterable<string>) => void prepared.push(...ids),
  };
  const space = { building: -1, cell: -1 };
  const at = new THREE.Vector3();
  for (const fps of FPS) {
    played.length = 0;
    stopped.length = 0;
    prepared.length = 0;
    const sounds = new GrappleSounds();
    sounds.attach(host, null);
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      box(p, [-101, 0, -20], [-99, 40, 20], true);
      beam = box(p, [-0.5, 30, -0.5], [0.5, 31, 0.5], false);
    });
    const step = () => sounds.step(b.grapple, b.hand(at), b.vel, space, true);
    b.place(0, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.3, step);
    // A dart flown 100 m to a wall: the fire's clank and the bite's clicks, and no ratchet at all on the way.
    b.fireAt = { x: -99, y: 1.32, z: 0 };
    b.key('Mouse3', true);
    b.frame(1 / fps);
    step();
    b.key('Mouse3', false);
    let flew = 0;
    while (b.grapple.flying && flew < 2 * fps) {
      b.frame(1 / fps);
      step();
      flew++;
    }
    ok(b.grapple.attached && flew / fps > 0.5 && b.grapple.counts.ratchets === 0, `${fps} fps: a 100 m dart flight (${r2(flew / fps)} s) asks for no ratchet`);
    ok(played.filter((p) => p.id === GRAPPLE_SOUND.fire).length === 1 && played.filter((p) => p.id === GRAPPLE_SOUND.bite).length === 1, `${fps} fps: one clank as it fired and one bite as it held`);
    ok(GRAPPLE_SOUND_IDS.every((id) => prepared.includes(id) || id === GRAPPLE_SOUND.boost), `${fps} fps: every one of the hook's sounds was asked for before it was needed`);
    b.grapple.letGo('console');
    // Hanging under a beam: two seconds of held reel at the base 6 m/s.
    b.place(2, 30 - 0.05 - 12 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 30, 0, 0, -1, 0, beam as never, 12.5);
    b.run(fps, 0.3, step);
    const r0 = b.grapple.counts.ratchets;
    const plays0 = played.filter((p) => p.id === GRAPPLE_SOUND.ratchet).length;
    b.key('ShiftLeft', true);
    b.run(fps, 2, step);
    b.key('ShiftLeft', false);
    const reeled = b.grapple.counts.ratchets - r0;
    const ratchetPlays = played.filter((p) => p.id === GRAPPLE_SOUND.ratchet);
    ok(reeled > 0 && reeled <= 2 * GRAPPLE_TUNE.tickMax && ratchetPlays.length - plays0 === reeled && ratchetPlays.every((p) => p.pitch === GRAPPLE_TUNE.reelPitch), `${fps} fps: a 2 s held reel at 6 m/s asks for ${reeled} ratchets (at most ${2 * GRAPPLE_TUNE.tickMax}), each played once, pitched up ${GRAPPLE_TUNE.reelPitch}`);
    // Two seconds of haul: its rumble, once, and no ratchet; let go of F, the rumble fades. The reel above wound the rope
    // to its shortest, where F has nothing to haul, so it is hooked again on 12.5 m first, and the haul is seen to run.
    b.grapple.letGo('console');
    b.place(2, 30 - 0.05 - 12 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 30, 0, 0, -1, 0, beam as never, 12.5);
    b.run(fps, 0.3, step);
    const r1 = b.grapple.counts.ratchets;
    const lenBefore = b.grapple.rope.length;
    let hauledFrames = 0;
    b.key('KeyF', true);
    b.run(fps, 2, () => {
      step();
      if (b.grapple.hauling) hauledFrames++;
    });
    b.key('KeyF', false);
    b.run(fps, 0.1, step);
    const loops = played.filter((p) => p.id === GRAPPLE_SOUND.haul && p.loop);
    ok(hauledFrames > 0.2 * fps && b.grapple.rope.length < lenBefore - 5, `${fps} fps: F hauls for ${r2(hauledFrames / fps)} s, the rope taken in from ${r2(lenBefore)} m to ${r2(b.grapple.rope.length)} m`);
    ok(b.grapple.counts.ratchets === r1 && loops.length === 1 && stopped.some((s) => s.key === loops[0].key && s.fade === GRAPPLE_TUNE.haulFade), `${fps} fps: and that haul asks for no ratchet; its rumble is looped once and faded over ${GRAPPLE_TUNE.haulFade} s as F is let go`);
    ok(played.every((p) => p.id !== GRAPPLE_SOUND.wind), `${fps} fps: and the speed wind ships off`);
  }
  // The hook's own cap, which the base reel never reaches (6 m/s asks for exactly tickMax a second by distance alone): the
  // reel raised to 30 m/s winds in 60 ratchets' worth a second and asks for no more than tickMax in any second of the
  // hook's own clock. With the cap off (tickMax 1000) the same reel asks for far more (the test sees the fault). And a
  // fast reel banks nothing: slowed to 1 m/s it asks for what 1 m/s winds in, not what the fast reel wound in past the cap.
  const reelRun = async (fps: number, tickMax: number) => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      beam = box(p, [-0.5, 30, -0.5], [0.5, 31, 0.5], false);
    });
    tuneGrapple({ reel: 30, tickMax });
    b.place(0, 0.02, 0);
    physics.stepOnce();
    b.run(fps, 0.2);
    // A hundred metres of rope over a 29 m drop: slack the whole time, so the reel winds and nothing lifts.
    b.hook(0, 30, 0, 0, -1, 0, beam as never, 100);
    const at: number[] = [];
    let seen = b.grapple.counts.ratchets;
    const each = () => {
      for (; seen < b.grapple.counts.ratchets; seen++) at.push(b.grapple.clock);
    };
    b.key('ShiftLeft', true);
    b.run(fps, 2, each);
    const fast = at.length;
    let most = 0;
    for (let k = 0; k < at.length; k++) {
      let n = 0;
      for (let j = k; j < at.length && at[j] - at[k] < 1 - 1e-9; j++) n++;
      most = Math.max(most, n);
    }
    // Slowed to 1 m/s, the held reel goes on: what it asks for now is its own.
    tuneGrapple({ reel: 1 });
    const before = at.length;
    const lenSlow = b.grapple.rope.length;
    b.run(fps, 2, each);
    b.key('ShiftLeft', false);
    const slow = at.length - before;
    const reeledSlow = lenSlow - b.grapple.rope.length;
    return { fast, most, slow, reeledSlow, len: b.grapple.rope.length };
  };
  for (const fps of FPS) {
    const capped = await reelRun(fps, GRAPPLE_DEFAULTS.tickMax);
    // What the cap lets through at this frame rate: a ratchet every whole number of frames no shorter than a tickMax-th.
    const most = Math.floor(fps / Math.ceil(fps / GRAPPLE_DEFAULTS.tickMax - 1e-9));
    ok(capped.most <= GRAPPLE_DEFAULTS.tickMax && capped.most >= most && capped.fast <= 2 * GRAPPLE_DEFAULTS.tickMax + 1, `${fps} fps: the held reel at 30 m/s asks for ${capped.fast} ratchets in 2 s, at most ${capped.most} in any second of the hook's clock (the cap ${GRAPPLE_DEFAULTS.tickMax} binding)`);
    const byDistance = Math.floor(capped.reeledSlow / GRAPPLE_DEFAULTS.tickEvery);
    ok(capped.reeledSlow > 1.5 && capped.slow <= byDistance + 1, `${fps} fps: slowed to 1 m/s it winds in ${r2(capped.reeledSlow)} m and asks for ${capped.slow} ratchets (that distance's ${byDistance}, one more at most): nothing banked from the fast reel`);
    const open = await reelRun(fps, 1000);
    ok(open.most > 2 * GRAPPLE_DEFAULTS.tickMax, `${fps} fps: with the cap lifted the same reel asks for ${open.most} in a second (the test sees the fault)`);
  }
  fresh();
});

// =============================================================================================================
await section(33, "the camera's pull and the jolt", async () => {
  for (const fps of FPS) {
    let top: unknown = null;
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      top = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
    });
    const L = 30;
    b.place(L, 39.95 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, top as never, L);
    let atBottom = 0;
    let let_ = false;
    let landedAt = -1;
    let backAt = -1;
    const dt = 1 / fps;
    for (let i = 0; i < 8 * fps; i++) {
      const x0 = b.pos.x;
      b.frame(dt);
      const t = (i + 1) * dt;
      if (!let_ && x0 > 0 && b.pos.x <= 0) {
        atBottom = b.grapple.camScaleNow;
        let_ = true;
        b.grapple.letGo('fire');
      }
      if (let_ && landedAt < 0 && b.grounded) landedAt = t;
      if (landedAt >= 0 && backAt < 0 && Object.is(b.grapple.camScaleNow, 1)) backAt = t;
    }
    ok(atBottom > 1.2, `${fps} fps: at the bottom of a 30 m swing from level the camera's scale is ${r3(atBottom)} (above 1.2)`);
    ok(landedAt > 0 && backAt > 0 && backAt - landedAt <= GRAPPLE_TUNE.camBack + dt && !b.grapple.lively, `${fps} fps: let go there, it is back to exactly 1 ${r2(backAt - landedAt)} s after the feet find ground (within ${GRAPPLE_TUNE.camBack} s), and nothing of the hook is left to step`);
  }
  // The catch: a slack rope going taut after 10 m of fall jolts the view a moment, by the design's rule.
  for (const fps of FPS) {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beam = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
    });
    b.place(0, 40 - 0.05 - 2 - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, beam as never, 12);
    let jolt = 0;
    let caught = 0;
    let lastJoltFrame = -1;
    for (let i = 0; i < 3 * fps; i++) {
      b.frame(1 / fps);
      if (b.grapple.joltNow > jolt) {
        jolt = b.grapple.joltNow;
        caught = b.grapple.lastCatch;
      }
      if (b.grapple.joltLeft > 0) lastJoltFrame = i;
    }
    ok(caught > 15 && Math.abs(jolt - joltFor(caught, GRAPPLE_TUNE)) < 1e-12 && jolt > 0.1 && jolt <= GRAPPLE_TUNE.joltMax, `${fps} fps: caught after 10 m of slack at ${r2(caught)} m/s, the view jolts by ${r3(jolt)} (joltFor of the catch)`);
    ok(lastJoltFrame >= 0 && b.grapple.joltLeft === 0 && b.grapple.joltNow === 0 && b.harms.length === 0, `${fps} fps: for ${GRAPPLE_TUNE.joltTime} s and then nothing, and the catch costs nothing`);
  }
});

// =============================================================================================================
await section(34, 'the lean and the arm', async () => {
  for (const fps of FPS) {
    let top: unknown = null;
    const { physics, b } = await scene((p) => {
      top = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
    });
    const L = 20;
    const th = Math.PI / 3;
    b.place(L * Math.sin(th), 39.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, top as never, L);
    const dt = 1 / fps;
    const rate = leanRate(GRAPPLE_TUNE) * dt;
    const level = (GRAPPLE_TUNE.leanLevel * Math.PI) / 180;
    let worstStep = 0;
    let worstGap = 0;
    let prev = 0;
    // The whole turn goes out on every frame the lean is past level (a frame it did not would have a receiver stand the
    // figure up), counted both ways round the let-go.
    let unsent = 0;
    let leaningFrames = 0;
    // The arm comes up over armIn, never in one frame.
    let armUp = -1;
    for (let i = 0; i < 2 * fps; i++) {
      b.frame(dt);
      const a = b.grapple.leanAngle;
      worstStep = Math.max(worstStep, Math.abs(a - prev));
      prev = a;
      if (a > level) {
        leaningFrames++;
        if (!b.grapple.leanSends) unsent++;
      }
      if (armUp < 0 && b.grapple.armWeight === 1) armUp = i + 1;
      if (i > 0.5 * fps) {
        // Settled, the lean is the tilt's share of the rope's own angle from upright.
        const piv = b.pivot();
        const ropeAngle = Math.acos((piv.y - (b.pos.y + GRAPPLE_TUNE.ropeY)) / Math.hypot(piv.x - b.pos.x, piv.y - (b.pos.y + GRAPPLE_TUNE.ropeY), piv.z - b.pos.z));
        worstGap = Math.max(worstGap, Math.abs(a - GRAPPLE_TUNE.tilt * Math.min(ropeAngle, Math.PI / 2)));
      }
    }
    ok(worstStep <= rate + 1e-9 && worstGap < 0.06 && b.grapple.armWeight === 1, `${fps} fps: swinging from 60 degrees the body leans the tilt's share of the rope's angle (within ${r3((worstGap * 180) / Math.PI)} degrees as it swings), never moving more than the lean's rate in a frame, the arm all the way up`);
    ok(armUp > 1 && Math.abs(armUp * dt - GRAPPLE_TUNE.armIn) <= dt + 1e-9, `${fps} fps: the arm came up the rope over ${r3(armUp * dt)} s as the hook went out (armIn ${GRAPPLE_TUNE.armIn}), never in one frame`);
    // Let go: upright within leanOut, never in one frame; the whole turn goes on going out until the lean has been level
    // for leanTail, and then stops.
    const before = b.grapple.leanAngle;
    b.grapple.letGo('fire');
    let frames = 0;
    let levelAt = -1;
    let sendsEnd = -1;
    let sentAfterEnd = false;
    prev = before;
    let biggest = 0;
    let upright = -1;
    let armDown = -1;
    while ((upright < 0 || armDown < 0 || sendsEnd < 0 || frames < (sendsEnd + 0.2 * fps)) && frames < 10 * fps) {
      b.frame(dt);
      frames++;
      const a = b.grapple.leanAngle;
      biggest = Math.max(biggest, prev - a);
      prev = a;
      if (a > level) {
        leaningFrames++;
        if (!b.grapple.leanSends) unsent++;
      } else if (levelAt < 0) levelAt = frames;
      if (levelAt > 0 && sendsEnd < 0 && !b.grapple.leanSends) sendsEnd = frames;
      if (sendsEnd > 0 && b.grapple.leanSends) sentAfterEnd = true;
      if (upright < 0 && a === 0) upright = frames;
      if (armDown < 0 && b.grapple.armWeight === 0) armDown = frames;
    }
    ok(before > level && upright > 1 && upright * dt <= GRAPPLE_TUNE.leanOut + dt && biggest <= rate + 1e-9, `${fps} fps: let go leaning ${r2((before * 180) / Math.PI)} degrees, it is upright in ${r3(upright * dt)} s (within leanOut ${GRAPPLE_TUNE.leanOut}), never in one frame`);
    ok(leaningFrames > fps && unsent === 0, `${fps} fps: its whole turn goes out on every one of the ${leaningFrames} frames it leans past leanLevel, swinging and easing upright`);
    const tail = (sendsEnd - levelAt) * dt;
    ok(levelAt > 0 && sendsEnd > levelAt && Math.abs(tail - GRAPPLE_TUNE.leanTail) <= dt + 1e-9 && !sentAfterEnd, `${fps} fps: and for ${r3(tail)} s after it is level (leanTail ${GRAPPLE_TUNE.leanTail}), so the last turn a receiver hears is upright; then it stops`);
    ok(armDown > 1 && Math.abs(armDown * dt - GRAPPLE_TUNE.armOut) <= dt + 1e-9, `${fps} fps: the arm comes down over ${r3(armDown * dt)} s (armOut ${GRAPPLE_TUNE.armOut})`);
  }
  // Afloat the body eases upright, the rope still in.
  for (const fps of FPS) {
    let top: unknown = null;
    const { physics, b } = await scene((p) => {
      top = box(p, [-0.5, 30, -0.5], [0.5, 31, 0.5], false);
    });
    b.surface = () => 10;
    b.place(8, 8.6, 0);
    physics.stepOnce();
    b.hook(0, 30, 0, 0, -1, 0, top as never, 40);
    b.grapple.lean.x = 0;
    b.grapple.lean.z = -Math.sin(0.3);
    b.grapple.lean.w = Math.cos(0.3);
    b.grapple.leanAngle = 0.6;
    b.run(fps, 1);
    ok(b.swimming && b.grapple.modes.afloat && b.grapple.attached && b.grapple.leanAngle === 0 && b.grapple.armWeight === 1, `${fps} fps: afloat on the rope the body eases upright (${r3(b.grapple.leanAngle)}) and the arm stays up it`);
  }
});

// =============================================================================================================
await section(35, 'nothing of wave 2 for a body that never fires', async () => {
  for (const fps of FPS) {
    const { physics, b } = await scene((p) => {
      ground(p, 0);
      box(p, [10, 0, -5], [20, 8, 5]);
    });
    b.place(0, 0.05, 0);
    physics.stepOnce();
    let lively = 0;
    let worst = 0;
    const dt = 1 / fps;
    for (let i = 0; i < 4 * fps; i++) {
      b.key('KeyW', i < 3 * fps);
      b.key('Space', i % fps === 0);
      b.frame(dt);
      if (b.grapple.lively) lively++;
      if (!Object.is(b.grapple.camScaleNow, 1)) worst++;
    }
    b.key('KeyW', false);
    b.key('Space', false);
    ok(lively === 0 && worst === 0 && !b.grapple.released && b.grapple.leanAngle === 0 && b.grapple.armWeight === 0 && b.grapple.counts.slams === 0 && b.harms.length === 0, `${fps} fps: walking and jumping with the hook never fired, nothing of it is ever lively, the camera's scale is 1 by Object.is, and nothing slams`);
  }
});

// =============================================================================================================
await section(36, 'what ends the fast flight, and what stands it all down', async () => {
  // Let go at 30 m/s in open air, far from anything: the fast flight runs.
  const flying = async () => {
    let beam: unknown = null;
    const { physics, b } = await scene((p) => {
      beam = box(p, [49.5, 20, -0.5], [50.5, 21, 0.5], false);
    });
    b.place(0, 5, 0);
    physics.stepOnce();
    b.hook(50, 20, 0, -1, 0, 0, beam as never, 100);
    b.vel.set(-30, 0, 0);
    b.grapple.letGo('fire');
    return { physics, b, beam };
  };
  // A new hook ends it, fired or fastened.
  {
    const { physics, b } = await flying();
    const was = b.grapple.released;
    const h = b.hand();
    b.grapple.fire(50, 20.5, 0, h, b.vel, physics, b.filter, b.body, 1, 0, 0);
    const afterFire = b.grapple.released;
    const second = await flying();
    second.b.hook(50, 20, 0, -1, 0, 0, second.beam as never, 100);
    ok(was && !afterFire && b.grapple.flying && !second.b.grapple.released && second.b.grapple.attached, 'let go at 30 m/s the flight runs; a new fire ends it, and so does a rope fastened at once');
  }
  // The water, a roll and a special move end it (each writes the velocity of its own), each read as the clip reads the
  // body, on a view of the same body: the control, the plain body at the same speed, keeps flying.
  {
    const { b } = await flying();
    b.grapple.clip(b);
    const plain = b.grapple.released;
    const view = (over: Record<string, unknown>) => Object.assign(Object.create(b), over);
    const ended: string[] = [];
    for (const [what, over] of [
      ['the water', { swimming: true }],
      ['a roll', { jka: { holdApex() {}, rolling: true, inSpecialJump: false } }],
      ['a special move', { jka: { holdApex() {}, rolling: false, inSpecialJump: true } }],
    ] as const) {
      b.grapple.released = true;
      b.grapple.clip(view(over));
      if (!b.grapple.released) ended.push(what);
    }
    ok(plain && ended.length === 3, `at 30 m/s with nothing struck the flight holds; it ends in ${ended.join(', ')}`);
  }
  // Every way out that puts the body somewhere new, gives it away or kills it stands everything down at once -- the
  // flight, the stagger, the lean, its tail on the wire, the arm and the camera's pull -- with a rope out or not; every
  // other let-go is the body flying on, and leaves them all to ease.
  const ends = ['reset', 'stand', 'death', 'board', 'leave', 'mount', 'noclip', 'eva', 'travel', 'select', 'lift', 'doorless', 'world', 'moved'] as const;
  const fliesOn = ['fire', 'boost', 'arrived', 'inside', 'placing', 'loose', 'fouled', 'console'] as const;
  for (const roped of [false, true]) {
    const wrong: string[] = [];
    for (const reason of [...ends, ...fliesOn]) {
      const { b, beam } = await flying();
      if (roped) {
        b.hook(50, 20, 0, -1, 0, 0, beam as never, 100);
        b.vel.set(-30, 0, 0);
      }
      const g = b.grapple;
      g.released = true;
      g.staggerNow();
      g.lean.z = -Math.sin(0.2);
      g.lean.w = Math.cos(0.2);
      g.leanAngle = 0.4;
      g.leanTailLeft = 0.3;
      g.armWeight = 0.5;
      g.camScaleNow = 1.2;
      g.letGo(reason);
      const calm = !g.released && !g.staggered && g.leanAngle === 0 && !g.leanSends && g.armWeight === 0 && Object.is(g.camScaleNow, 1) && !g.lively;
      const end = (ends as readonly string[]).includes(reason);
      if (calm !== end) wrong.push(reason);
    }
    ok(wrong.length === 0, `${roped ? 'on the rope' : 'with nothing out'}, ${ends.length} ways out stand everything down at once and ${fliesOn.length} leave it to ease (${wrong.join(', ') || 'none wrong'})`);
  }
  fresh();
});

// =============================================================================================================
await section(37, 'the lean on the wire', async () => {
  // A swing let go of, sent as `stepNet` sends it -- at most every 100 ms, the whole turn (rounded to three places) while
  // `leanSends`, the heading always -- and drawn by two receivers at the same frame rate: this build's glide
  // (`glidePeerTurn`) and the glide that came before it, written out (a browser built before cannot be changed). This
  // build's must never jump: every frame's change of tilt is within what a glide toward its target can make, and once
  // upright it faces the heading. The old one snapped a leaning figure upright the frame `q` stopped, and read a heading
  // past a quarter turn mirrored: with the tail its snap is under half a degree, and without it (`leanTail` 0, the
  // sender this build replaced) it is many degrees (the test sees the fault).
  const { UPRIGHT_EPS, glidePeerTurn, yawOf } = await import('../../../src/net/peerTurn.ts');
  // The one step a glide does not make: the hand-back to the heading's own glide, from under this tilt to none.
  const handBack = 2 * Math.asin(Math.sqrt(UPRIGHT_EPS)) + 1e-9;
  const oldGlide = (obj: InstanceType<typeof THREE.Object3D>, targetQ: InstanceType<typeof THREE.Quaternion> | null, heading: number, k: number) => {
    if (targetQ) obj.quaternion.slerp(targetQ, k);
    else {
      let diff = heading - obj.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      obj.rotation.set(0, obj.rotation.y + diff * k, 0);
    }
  };
  const tiltOf = (q: InstanceType<typeof THREE.Quaternion>) => 2 * Math.asin(Math.min(1, Math.sqrt(q.x * q.x + q.z * q.z)));
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const UP = new THREE.Vector3(0, 1, 0);
  const run = async (fps: number, headingDeg: number, leanTail: number) => {
    let top: unknown = null;
    const { physics, b } = await scene((p) => {
      top = box(p, [-0.5, 40, -0.5], [0.5, 41, 0.5], false);
    });
    GRAPPLE_TUNE.leanTail = leanTail;
    const L = 20;
    const th = Math.PI / 3;
    b.place(L * Math.sin(th), 39.95 - L * Math.cos(th) - GRAPPLE_TUNE.ropeY, 0);
    physics.stepOnce();
    b.hook(0, 40, 0, 0, -1, 0, top as never, L);
    const h = (headingDeg * Math.PI) / 180;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(UP, h);
    const drawn = new THREE.Quaternion();
    const sent = new THREE.Quaternion();
    const upright = new THREE.Quaternion().setFromAxisAngle(UP, h);
    const now = new THREE.Object3D();
    const before = new THREE.Object3D();
    const s = { turned: false };
    let targetQ: InstanceType<typeof THREE.Quaternion> | null = null;
    const dt = 1 / fps;
    const k = 1 - Math.exp(-dt / 0.1);
    let t = 0;
    let lastSent = -Infinity;
    let worstJump = 0;
    let worstYaw = 0;
    let oldSnap = 0;
    let oldYaw = 0;
    let stoppedAt = -1;
    let letGoAt = -1;
    let leanAtLetGo = 0;
    for (let i = 0; i < Math.round(2.5 * fps); i++) {
      if (letGoAt < 0 && t >= 0.5) {
        letGoAt = t;
        leanAtLetGo = b.grapple.leanAngle;
        b.grapple.letGo('fire');
      }
      b.frame(dt);
      t += dt;
      // The figure as placeVisual stands it: the heading, then the lean.
      const l = b.grapple.lean;
      drawn.copy(yawQ).premultiply(sent.set(l.x, l.y, l.z, l.w));
      if (t - lastSent >= 0.1 - 1e-9) {
        lastSent = t;
        if (b.grapple.leanSends) {
          const r = (v: number) => Number(v.toFixed(3));
          targetQ = (targetQ ?? new THREE.Quaternion()).set(r(drawn.x), r(drawn.y), r(drawn.z), r(drawn.w)).normalize();
        } else {
          if (targetQ && stoppedAt < 0) stoppedAt = t;
          targetQ = null;
        }
      }
      // This build's receiver: never a jump in tilt past what one glide step toward its target makes.
      const prevNow = now.quaternion.clone();
      glidePeerTurn(now, targetQ, h, k, s);
      const aim = targetQ ?? upright;
      const allowed = k * prevNow.angleTo(aim) + 1e-6;
      worstJump = Math.max(worstJump, Math.abs(tiltOf(now.quaternion) - tiltOf(prevNow)) - allowed);
      if (letGoAt >= 0 && tiltOf(now.quaternion) < (1 * Math.PI) / 180) worstYaw = Math.max(worstYaw, Math.abs(wrap(yawOf(now.quaternion) - h)));
      // The receiver built before.
      const prevOld = tiltOf(before.quaternion);
      const hadQ = !!targetQ;
      oldGlide(before, targetQ, h, k);
      if (!hadQ && prevOld > 0) oldSnap = Math.max(oldSnap, prevOld - tiltOf(before.quaternion) - k * prevOld);
      if (letGoAt >= 0 && !hadQ) oldYaw = Math.max(oldYaw, Math.abs(wrap(yawOf(before.quaternion) - h)));
    }
    return { worstJump, worstYaw, oldSnap, oldYaw, stoppedAt, letGoAt, leanAtLetGo, turned: s.turned, finalYaw: Math.abs(wrap(yawOf(now.quaternion) - h)), finalTilt: tiltOf(now.quaternion) };
  };
  const deg = (r: number) => r2((r * 180) / Math.PI);
  for (const fps of FPS) {
    for (const headingDeg of [30, 150]) {
      const w = await run(fps, headingDeg, GRAPPLE_DEFAULTS.leanTail);
      ok(w.leanAtLetGo > 0.2 && w.stoppedAt > w.letGoAt && w.worstJump < handBack && !w.turned && w.finalTilt < 1e-3 && w.finalYaw < 1e-3 && w.worstYaw < (1 * Math.PI) / 180, `${fps} fps, facing ${headingDeg}: let go leaning ${deg(w.leanAtLetGo)} degrees, the turn sent until ${r2(w.stoppedAt - w.letGoAt)} s on; this build's receiver never jumps (${r3((Math.max(0, w.worstJump) * 180) / Math.PI)} degrees past a glide's step at most, the hand-back to its heading), faces within ${deg(w.worstYaw)} degrees of the heading once upright, and ends upright on it`);
      ok(w.oldSnap < (0.5 * Math.PI) / 180, `${fps} fps, facing ${headingDeg}: a receiver built before stands the figure up by ${deg(w.oldSnap)} degrees in one frame when the turn stops (under half a degree, the tail's doing)`);
      if (headingDeg > 90) ok(w.oldYaw > Math.PI / 3, `${fps} fps, facing ${headingDeg}: and reads that heading mirrored for a moment (${deg(w.oldYaw)} degrees off), which only this build's receiver mends`);
      const bare = await run(fps, headingDeg, 0);
      ok(bare.oldSnap > (2 * Math.PI) / 180 && bare.worstJump < handBack, `${fps} fps, facing ${headingDeg}: with no tail the receiver built before snaps ${deg(bare.oldSnap)} degrees upright in one frame (the test sees the fault), and this build's still glides`);
    }
  }
  fresh();
});

console.log(`\n${checks} checks passed`);
