// Climbing II, the feedback round II (maker A): the bar and the camera, a swing that settles, and the free hang on a bar (items 0a
// to 0c), through the game's own movement and climbing on the real Rapier (the grapple's harness, tools/swg/tests/grappleBody.ts,
// and the course's bars stood by tools/swg/tests/climbCourseBody.ts) at 30, 60, 144 and 240 frames a second, and the game's own
// rig posed by the bar's hand-over and the ledges' limb solve (tools/swg/tests/climbFigure.ts's `drawBarFrame`):
//  - 0a (`climb.barCamera` 'pass'): the camera's block (`Physics.cameraBlock`) leaves out one collider handed to the engine's ray as
//    its excluded collider; on `bars-2` to `bars-5`, rays from the hanging body's head out behind it, through a pumped swing, a
//    flight and the catch of the next bar, are never stopped by the bar held or the bar let go, the same rays are stopped at it
//    under 'block', and a wall beside the bar still stops them;
//  - 0b (`climb.barSettle` 'swings'): a swing pumped to its largest and let alone comes under `barSettleTo` within
//    `barSettleSwings` swings (a half swing either way), at every rate and at the slider's other numbers; W held, it still builds;
//    under 'damp' it dies away as before, slower;
//  - 0c (`climb.barHang` 'free'): a still hang crossfades into the free hang's own loop, the hands on the bar within 2 cm; A and D
//    play the free hang's shimmy at the shift's own speed, the hands on the bar; W crossfades back into the swing's clip played by
//    the angle; under 'swing' the swing's clip whatever the swing;
//  - with every switch of the round at its other setting the round's put back is the ropes commit's; the hand-overs only the game
//    makes, pinned as text.
//
// Run: node tools/swg/tests/climbFb2Bars.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { drawBarFrame, figure, type Figure } from './climbFigure.ts';

const { RAPIER } = await import('../../../src/core/physics.ts');
const { TestBody, ground, makePhysics } = await import('./grappleBody.ts');
const { CLIMB_FB2_BEFORE, CLIMB_TUNE, CLIMB_TUNE_SHIPPED, climbFb2Before, climbRopesBefore, resetClimbTune, tuneClimb } = await import('../../../src/anim/climbTune.ts');
const { BAR_CLIP, BAR_CLIP_NAMES, measureBarTable } = await import('../../../src/anim/barClips.ts');
const { BAR_FLY, BAR_GRAB, BAR_SWING, BAR_FREE_IDLE, BAR_FREE_LEFT, BAR_FREE_RIGHT } = await import('../../../src/player/barSwing.ts');
const { LEDGE_FACTS, LEDGE_ROLES } = await import('../../../src/anim/ledgeClips.ts');
const { isHangState } = await import('../../../src/player/peerHang.ts');
const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { bodyAt, standPiece } = await import('./climbCourseBody.ts');
const { runJumpAtBar } = await import('./climbFb2Body.ts');
const { REPO } = await import('./oldModules.ts');
type Body = InstanceType<typeof TestBody>;
type Phys = Awaited<ReturnType<typeof makePhysics>>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const RATES = [30, 60, 144, 240] as const;
const DEG = 180 / Math.PI;
const fresh = () => resetClimbTune();
fresh();

/** A world with a bar `y` m over open ground across x at z 0. */
async function barWorld(y: number): Promise<Phys> {
  const p = await makePhysics();
  ground(p, 0);
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, y, 0));
  p.stepOnce();
  return p;
}
/** A body under it, E pressed (a still hang straight under the bar). */
function hangUnder(p: Phys, fps: number): Body {
  (p as unknown as { acc: number }).acc = 0;
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, 0);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  b.run(fps, 0.5);
  b.key('KeyE', true);
  b.frame(1 / fps);
  b.key('KeyE', false);
  return b;
}

// ---- 0a: the camera's block leaves out one collider -----------------------------------------------------------------------------
{
  const p = await barWorld(2.2);
  const bar = p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.035, 0.035).setTranslation(0, 1.5, 5));
  const wall = p.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 2, 0.1).setTranslation(0, 1.5, 7));
  p.stepOnce();
  const from = { x: 0, y: 1.5, z: 3 };
  const to = { x: 0, y: 1.5, z: 9 };
  const plain = p.cameraBlock(from, to, null, false);
  const pass = p.cameraBlock(from, to, null, false, bar);
  const other = p.cameraBlock(from, to, null, false, wall);
  const all = p.cameraBlock(from, to, null, false, null);
  ok(plain !== null && Math.abs(plain - 1.965) < 1e-4 && pass !== null && Math.abs(pass - 3.9) < 1e-4 && other !== null && Math.abs(other - 1.965) < 1e-4 && all === plain, `the camera's block passes the one collider it is handed, and only it (stopped at the bar at ${plain?.toFixed(3)} m; the bar left out, at the wall behind it at ${pass?.toFixed(3)} m; the wall left out, still at the bar; none handed, as before)`);
}

/** The boost each spacing is caught at (phase 3's: the start's for 2 and 3 m, the slider raised for 4 and 5). */
const BOOST: Record<string, number> = { 'bars-2': CLIMB_TUNE.barBoost, 'bars-3': CLIMB_TUNE.barBoost, 'bars-4': 3, 'bars-5': 4.5 };
/** The probes: from the hanging body's head out behind it (the camera's way, pulled in close) at these pitches and turns, metres long. */
const PITCHES = [-10, 0, 15, 30, 45, 60, 75];
const TURNS = [-35, 0, 35];
const PROBE = 4;
{
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const rows: string[] = [];
  let stoppedHeld = 0;
  let stoppedLet = 0;
  let crossHeld = 0;
  let crossLet = 0;
  let wouldStop = 0;
  let wallStops = 0;
  let wallMiss = 0;
  let caughtAll = true;
  for (const id of ['bars-2', 'bars-3', 'bars-4', 'bars-5']) {
    for (const fps of RATES) {
      fresh();
      tuneClimb({ barBoost: BOOST[id] });
      const s = await standPiece(climbCourse({ pieces: [id] }).pieces[0]);
      const { b } = bodyAt(s, 'run', fps);
      const dt = 1 / fps;
      runJumpAtBar(s, b, fps);
      const B = b.bar;
      // A wall beside the body, a metre along the bar from the hands, standing from under the body to just under the bar (never through it).
      const gx = B.bar.ax + B.bar.ux * B.s + B.bar.ux * 1.0;
      const gy = B.bar.ay;
      const gz = B.bar.az + B.bar.uz * B.s + B.bar.uz * 1.0;
      const w = s.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 1.425, 1.5).setTranslation(gx, gy - 1.575, gz).setRotation({ x: 0, y: Math.sin(Math.atan2(-B.bar.uz, B.bar.ux) / 2), z: 0, w: Math.cos(Math.atan2(-B.bar.uz, B.bar.ux) / 2) }));
      // (Asked of the world only once the physics has stepped since the wall stood: a query sees nothing new before.)
      const wallFrom = s.physics.steps;
      let pressed = false;
      let caughtT = -1;
      let t = 0;
      let held = 0;
      let flown = 0;
      for (let i = 0; i < 16 * fps && (caughtT < 0 || t < caughtT + 1.5); i++) {
        const th = B.th * DEG;
        const amp = (B.report() as { amplitude: number }).amplitude;
        const want = B.phase === BAR_SWING && amp > 55 && B.om > 0 && th > 32 && th < 50 && !pressed;
        b.key('KeyW', B.onBar && !want);
        b.key('Space', want);
        if (want) pressed = true;
        b.frame(dt);
        t += dt;
        if (caughtT < 0 && B.catches > 0) caughtT = t;
        const col = B.cameraCollider() as unknown as InstanceType<typeof RAPIER.Collider> | null;
        if (!B.holding || !col) continue;
        if (B.phase === BAR_FLY) flown++;
        else held++;
        const eye = { x: b.pos.x, y: b.pos.y + 1.55, z: b.pos.z };
        for (const turn of TURNS) {
          for (const pitch of PITCHES) {
            const yaw = B.heading + Math.PI + (turn * Math.PI) / 180;
            const cp = Math.cos((pitch * Math.PI) / 180);
            const dx = Math.sin(yaw) * cp;
            const dy = Math.sin((pitch * Math.PI) / 180);
            const dz = Math.cos(yaw) * cp;
            ray.origin.x = eye.x;
            ray.origin.y = eye.y;
            ray.origin.z = eye.z;
            ray.dir.x = dx;
            ray.dir.y = dy;
            ray.dir.z = dz;
            const tb = col.castRay(ray, PROBE, true);
            if (tb < 0) continue;
            const to = { x: eye.x + dx * PROBE, y: eye.y + dy * PROBE, z: eye.z + dz * PROBE };
            const block = s.physics.cameraBlock(eye, to, b.body, false, col);
            const without = s.physics.cameraBlock(eye, to, b.body, false, null);
            const atBar = block !== null && Math.abs(block - tb) < 1e-3;
            if (B.phase === BAR_FLY) {
              crossLet++;
              if (atBar) stoppedLet++;
            } else {
              crossHeld++;
              if (atBar) stoppedHeld++;
            }
            if (without !== null && Math.abs(without - tb) < 1e-3) wouldStop++;
          }
        }
        // Toward the wall beside: along the bar from the head, a little down and further.
        for (const pitch of [-40, -20, -5]) {
          if (s.physics.steps === wallFrom) break;
          const cp = Math.cos((pitch * Math.PI) / 180);
          const dx = B.bar.ux * cp;
          const dy = Math.sin((pitch * Math.PI) / 180);
          const dz = B.bar.uz * cp;
          ray.origin.x = eye.x;
          ray.origin.y = eye.y;
          ray.origin.z = eye.z;
          ray.dir.x = dx;
          ray.dir.y = dy;
          ray.dir.z = dz;
          const tw = w.castRay(ray, PROBE, true);
          if (tw < 0) continue;
          const block = s.physics.cameraBlock(eye, { x: eye.x + dx * PROBE, y: eye.y + dy * PROBE, z: eye.z + dz * PROBE }, b.body, false, col);
          if (block !== null && block <= tw + 1e-4) wallStops++;
          else wallMiss++;
        }
      }
      caughtAll &&= B.catches > 0;
      if (fps === 30 || fps === 240) rows.push(`${id}@${fps}: ${held} frames on bars, ${flown} in the flight, ${B.catches} caught`);
    }
  }
  fresh();
  ok(caughtAll && crossHeld > 1000 && crossLet > 50, `on bars-2 to bars-5 at every rate the body swung, flew and caught the next bar, and the camera's rays out behind its head crossed the bar held ${crossHeld} times and the bar let go ${crossLet} times in the flight (${rows.join('; ')})`);
  ok(stoppedHeld === 0 && stoppedLet === 0, `under 'pass' not one of them was stopped by the bar held (${stoppedHeld}) or the bar let go (${stoppedLet})`);
  ok(wouldStop > 500, `and handed no bar to leave out (as under 'block'), ${wouldStop} of the same rays are stopped at it`);
  ok(wallStops > 100 && wallMiss === 0, `a wall beside the bar still stops the camera every time (${wallStops} rays stopped at it, ${wallMiss} not)`);
  tuneClimb({ barCamera: 'block' });
  const s = await standPiece(climbCourse({ pieces: ['bars-2'] }).pieces[0]);
  const { b } = bodyAt(s, 'run', 60);
  runJumpAtBar(s, b, 60);
  ok(b.bar.holding && b.bar.cameraCollider() === null, 'under \'block\' the bar held hands the camera nothing to leave out (every bar a wall to it, as before)');
  fresh();
  ok(b.bar.cameraCollider() !== null && CLIMB_TUNE.barCamera === 'pass', 'the game ships \'pass\'');
}

// ---- 0b: a swing let alone settles in its swings ---------------------------------------------------------------------------------
/**
 * A still hang pumped by W for ten seconds to the largest swing and let alone (or W kept held): the turning points from the let-go
 * counted (two a swing out and back) until the first whose angle is under `barSettleTo`: the swings it took. Infinity for never in
 * `most` seconds.
 */
async function settleSwings(fps: number, keepW = false, most = 12): Promise<{ swings: number; from: number; last: number }> {
  const p = await barWorld(2.2);
  const b = hangUnder(p, fps);
  const dt = 1 / fps;
  b.key('KeyW', true);
  for (let i = 0; i < 10 * fps; i++) b.frame(dt);
  if (!keepW) b.key('KeyW', false);
  const from = (b.bar.report() as { amplitude: number }).amplitude;
  const to = CLIMB_TUNE.barSettleTo;
  let turns = 0;
  let last = Number.NaN;
  let om = b.bar.om;
  for (let i = 0; i < most * fps; i++) {
    b.frame(dt);
    const now = b.bar.om;
    if ((now > 0) !== (om > 0) && om !== 0) {
      turns++;
      last = Math.abs(b.bar.th) * DEG;
      if (last < to) {
        b.key('KeyW', false);
        return { swings: turns / 2, from, last };
      }
    }
    om = now;
  }
  b.key('KeyW', false);
  return { swings: Infinity, from, last };
}
{
  const rows: string[] = [];
  let inSwings = true;
  const all: number[] = [];
  for (const fps of RATES) {
    const r = await settleSwings(fps);
    all.push(r.swings);
    inSwings &&= Math.abs(r.swings - CLIMB_TUNE.barSettleSwings) <= 0.5;
    rows.push(`${fps}: from ${r.from.toFixed(1)} degrees, under ${CLIMB_TUNE.barSettleTo} in ${r.swings} swings`);
  }
  ok(inSwings, `a swing pumped to its largest and let alone comes under barSettleTo (${CLIMB_TUNE.barSettleTo} degrees) within barSettleSwings (${CLIMB_TUNE.barSettleSwings}) swings, a half swing either way, at every rate (${rows.join('; ')})`);
  ok(all.every((x) => x === all[0]), 'and in as many swings at every rate (the damping worked out on the physics\' own steps)');
  const slider: string[] = [];
  let follows = true;
  for (const n of [1.5, 2, 3, 4]) {
    tuneClimb({ barSettleSwings: n });
    const r = await settleSwings(60);
    follows &&= Math.abs(r.swings - n) <= 0.5;
    slider.push(`${n}: ${r.swings}`);
  }
  tuneClimb({ barSettleSwings: CLIMB_TUNE_SHIPPED.barSettleSwings, barSettleTo: 6 });
  const six = await settleSwings(60);
  follows &&= Math.abs(six.swings - CLIMB_TUNE.barSettleSwings) <= 0.5 && six.last < 6;
  slider.push(`under 6 degrees: ${six.swings}`);
  fresh();
  ok(follows, `the slider's other numbers are kept to as well (asked swings: taken ${slider.join(', ')})`);
  const w = await settleSwings(60, true, 8);
  ok(w.swings === Infinity && w.last > 50, `W held after the pumping, the swing still builds and never settles (its last turn at ${w.last.toFixed(1)} degrees)`);
  tuneClimb({ barSettle: 'damp' });
  const d = await settleSwings(60);
  fresh();
  ok(d.swings > 6, `under 'damp' the swing's own damping takes ${d.swings} swings to come under ${CLIMB_TUNE.barSettleTo} degrees (as before: slower)`);
}

// ---- 0c: the free hang on a bar --------------------------------------------------------------------------------------------------
const X = new THREE.Vector3();
/** Each hand's grip off the bar's line (the worst of the two), metres. */
function handsOff(b: Body, F: Figure): number {
  const B = b.bar.bar;
  let worst = 0;
  for (let s = 0; s < 2; s++) {
    const g = F.lp.gripNow(F.rig as never, s, null, X);
    if (!g) return Infinity;
    const a = (g.x - B.ax) * B.ux + (g.y - B.ay) * B.uy + (g.z - B.az) * B.uz;
    const d = Math.hypot(g.x - (B.ax + B.ux * a), g.y - (B.ay + B.uy * a), g.z - (B.az + B.uz * a));
    if (d > worst) worst = d;
  }
  return worst;
}
const currentAction = (F: Figure) => (F.rig as unknown as { current: THREE.AnimationAction | null }).current;
{
  const rows: string[] = [];
  let intoFree = true;
  let handsOk = true;
  let shimmyOk = true;
  let backOk = true;
  let againOk = true;
  let peersOk = true;
  for (const fps of RATES) {
    fresh();
    const p = await barWorld(2.2);
    const b = hangUnder(p, fps);
    const F = figure();
    const tab = measureBarTable(F.rig as never);
    const dt = 1 / fps;
    const B = b.bar;
    const frame = () => {
      b.frame(dt);
      drawBarFrame(b, F, dt, tab);
    };
    drawBarFrame(b, F, dt, tab);
    let worst = 0;
    let freeAt = Number.NaN;
    // Let alone: the grab carries it on, it swings nothing, and the free hang comes in over its blend.
    for (let i = 0; i < 3 * fps; i++) {
      frame();
      if (freeAt !== freeAt && B.free) freeAt = (i + 1) / fps;
      if (B.freeW > 0) worst = Math.max(worst, handsOff(b, F));
    }
    const loop = F.rig.currentClip;
    intoFree &&= B.free && B.freeW === 1 && F.rig.overrideName === null && loop === `mx_${LEDGE_ROLES.free.idle}` && freeAt === freeAt && freeAt < CLIMB_TUNE.barGrab + 0.1;
    peersOk &&= isHangState((F.rig as unknown as { state: string }).state);
    // A, then D: the free shimmy at the shift's own speed.
    const pace = (id: string) => Math.abs(LEDGE_FACTS[id].net[0]) / LEDGE_FACTS[id].dur;
    let leftRate = Number.NaN;
    let rightRate = Number.NaN;
    let leftClip = '';
    let rightClip = '';
    const s0 = B.s;
    b.key('KeyA', true);
    for (let i = 0; i < 1.5 * fps; i++) {
      frame();
      worst = Math.max(worst, handsOff(b, F));
      if (i === Math.round(fps) && B.freeState === BAR_FREE_LEFT) {
        leftClip = F.rig.currentClip ?? '';
        leftRate = currentAction(F)?.timeScale ?? Number.NaN;
      }
    }
    b.key('KeyA', false);
    const s1 = B.s;
    for (let i = 0; i < 0.5 * fps; i++) frame();
    b.key('KeyD', true);
    for (let i = 0; i < 1.5 * fps; i++) {
      frame();
      worst = Math.max(worst, handsOff(b, F));
      if (i === Math.round(fps) && B.freeState === BAR_FREE_RIGHT) {
        rightClip = F.rig.currentClip ?? '';
        rightRate = currentAction(F)?.timeScale ?? Number.NaN;
      }
    }
    b.key('KeyD', false);
    for (let i = 0; i < 0.5 * fps; i++) frame();
    const stillAgain = B.freeState === BAR_FREE_IDLE && F.rig.currentClip === `mx_${LEDGE_ROLES.free.idle}`;
    const wantL = CLIMB_TUNE.barShimmy / pace(LEDGE_ROLES.free.shimmyLeft);
    const wantR = CLIMB_TUNE.barShimmy / pace(LEDGE_ROLES.free.shimmyRight);
    shimmyOk &&= Math.abs(Math.abs(s1 - s0) - 1.5 * CLIMB_TUNE.barShimmy) < 0.02 && leftClip === `mx_${LEDGE_ROLES.free.shimmyLeft}` && rightClip === `mx_${LEDGE_ROLES.free.shimmyRight}` && Math.abs(leftRate - wantL) < 1e-9 && Math.abs(rightRate - wantR) < 1e-9 && stillAgain;
    handsOk &&= worst < 0.02;
    // W: back to the swing's clip, played by the angle, the free hang's share gone over its blend.
    b.key('KeyW', true);
    frame();
    const backNow = F.rig.overrideName === BAR_CLIP_NAMES[BAR_CLIP] && !B.free;
    let gone = Number.NaN;
    for (let i = 0; i < 3 * fps; i++) {
      frame();
      if (gone !== gone && B.freeW === 0) gone = (i + 2) / fps;
    }
    const seek = Math.abs(F.rig.overrideAt() - B.poseT);
    backOk &&= backNow && gone === gone && gone <= CLIMB_TUNE.barHangBlend + 2 / fps + 1e-9 && seek < 1e-9 && (B.report() as { amplitude: number }).amplitude > 10;
    b.key('KeyW', false);
    // Let alone again: it settles and the free hang comes back.
    let again = false;
    for (let i = 0; i < 8 * fps && !again; i++) {
      frame();
      again = B.free && B.freeW === 1 && F.rig.overrideName === null;
    }
    againOk &&= again;
    rows.push(`${fps}: free at ${freeAt.toFixed(3)} s, hands ${(worst * 1000).toFixed(1)} mm off the bar at worst, shimmy rates ${leftRate.toFixed(3)}/${rightRate.toFixed(3)}, the swing's share gone ${gone.toFixed(3)} s after W`);
  }
  ok(intoFree, `a still hang on a bar crossfades into the free hang's own loop (${LEDGE_ROLES.free.idle}) as the grab ends, the swing's clip let go of (${rows.map((r) => r.split(',')[0]).join('; ')})`);
  ok(handsOk, `through the loop, its crossfades and the shimmy each way the hands are on the bar within 2 cm by the ledges' limb solve (${rows.join('; ')})`);
  ok(shimmyOk, 'A and D move the hands along the bar at its speed, playing the free hang\'s shimmy clips each way at the shift\'s own speed over the clip\'s own pace, and still again the loop');
  ok(backOk, 'W crossfades back into the swing\'s clip (run_and_swing), put at the time the pendulum\'s angle asks, the free hang\'s share gone over barHangBlend, the swing building');
  ok(againOk, 'and let alone again it settles and the free hang comes back');
  ok(peersOk, 'in the free hang the rig\'s state is a hang state other players\' games draw (the wire\'s rig state: the free hang)');
  // Under 'swing' the swing's clip, whatever the swing.
  tuneClimb({ barHang: 'swing' });
  const p = await barWorld(2.2);
  const b = hangUnder(p, 60);
  const F = figure();
  const tab = measureBarTable(F.rig as never);
  // (The grab's own frame hands the rig its start: drawn once before the frames after it.)
  drawBarFrame(b, F, 1 / 60, tab);
  let free = false;
  for (let i = 0; i < 180; i++) {
    b.frame(1 / 60);
    drawBarFrame(b, F, 1 / 60, tab);
    free ||= b.bar.free || b.bar.freeW > 0;
  }
  ok(!free && F.rig.overrideName === BAR_CLIP_NAMES[BAR_CLIP] && b.bar.phase === BAR_SWING && !F.lp.busy, 'under \'swing\' a still hang holds the swing\'s clip, the hands left as the clip has them (as before)');
  fresh();
  void BAR_GRAB;
}

// ---- the switches' other settings, and the hand-overs ---------------------------------------------------------------------------
{
  climbRopesBefore();
  const back = Object.entries(CLIMB_FB2_BEFORE).every(([k, v]) => (CLIMB_TUNE as unknown as Record<string, unknown>)[k] === v);
  fresh();
  climbFb2Before();
  const own = CLIMB_TUNE.barCamera === 'block' && CLIMB_TUNE.barSettle === 'damp' && CLIMB_TUNE.barHang === 'swing';
  fresh();
  ok(back && own && CLIMB_TUNE.barCamera === 'pass' && CLIMB_TUNE.barSettle === 'swings' && CLIMB_TUNE.barHang === 'free', 'the ropes\' put back (and so every older round\'s chain) puts the round\'s switches to their other settings, the round\'s own put back too; the game ships them on');
  const text = (f: string) => readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
  const physics = text('src/core/physics.ts');
  const main = text('src/main.ts');
  const player = text('src/player/player.ts');
  const tune = text('src/anim/climbTune.ts');
  ok(physics.includes('const hit = this.world.castRay(ray, len, true, undefined, filter, excludeCollider ?? undefined, excludeBody ?? undefined, this.stillOrWall);'), 'the block hands the collider to the engine\'s ray as its excluded collider (never a predicate)');
  ok(main.includes('(from, to) => this.physics.cameraBlock(from, to, player.body, this.world.inside, player.barCamera())'), 'the camera\'s own call hands it the bar the player holds');
  ok(player.includes('(a: THREE.Vector3, b: THREE.Vector3) => this.physics.cameraBlock(a, b, this.body, this.inside, this.barCamera()) !== null'), 'and the player\'s own use of the block (the thrown saber\'s) does too');
  ok(player.includes('    return this.bar.cameraCollider() as unknown as RAPIER.Collider | null;'), 'the player\'s bar for the camera is the swing\'s own answer');
  const frame = player.slice(player.indexOf('  private barFrame(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {'));
  ok(/this\.animateBar\(dt\);\n    this\.placeVisual\(\);\n    \/\/ [^\n]*\n    if \(CLIMB_TUNE\.barHang === 'free' \|\| this\.barLimbs\) this\.placeBarLimbs\(\);\n    this\.body\.setNextKinematicTranslation/.test(frame), 'the player\'s bar frame puts the hands on the bar after the figure is drawn (as the tests\' figure does)');
  const limbs = player.slice(player.indexOf('  private placeBarLimbs(): void {'), player.indexOf('  barCamera(): RAPIER.Collider | null {'));
  ok(limbs.includes('const show = B.onBar && B.freeW > 0;') && limbs.includes('if (!show && !this.barLimbs) return;') && limbs.includes('this.group.updateMatrixWorld(true);') && limbs.includes('B.limbsFor(lp, rig, toPhys);') && limbs.includes('if (show) lp.place(rig, null, toPhys);') && limbs.includes('this.barLimbs = show;'), 'and the hands placed by the swing\'s own `limbsFor` and the limbs\' own solve, and let go of the frame after');
  ok(/export function climbRopesBefore\(\): void \{\n[^\n]*\n  climbFb2Before\(\);/.test(tune), 'the ropes\' put back calls the round\'s first');
}
console.log(`climbFb2Bars: ${checks} checks passed`);
