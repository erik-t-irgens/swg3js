// Climbing II, phase 5 (maker A): poles, under `climb.poles` 'on' (src/player/poleClimb.ts, what a pole is src/player/barShape.ts's
// `poleAxisOf`, the pole's clip src/anim/poleClips.ts and its hand-over src/player/hangClips.ts's `drivePoleClips`), through the
// game's own movement and climbing on the real Rapier (the grapple's harness, tools/swg/tests/grappleBody.ts, and the course's
// `poles` stood by tools/swg/tests/climbCourseBody.ts) at 30, 60, 144 and 240 frames a second, and the game's own rig posed by the
// hand-over (tools/swg/tests/climbFigure.ts):
//  - the clip: `climbing_a_rope_1` in the pack as the import's report has it (73 frames, 2.4 s, a loop, nothing under its feet),
//    its row in the import's table, asked for by the game, and measured on the human male (`POLE_FACTS`);
//  - what a pole is: the course's poles, a cylinder, a capsule and a mesh of that shape; never a bar, a post too thick, too short
//    or leaning too far, by the sliders, live;
//  - grabbing with E facing it, standing by it; never without E, out of reach, with the hook out, or where the hanging body has no
//    room (in words);
//  - on it (the round's session, tools/swg/tests/climbPolesBody.ts): W and S climb at the slider's speed and stop at its top and
//    its bottom, A and D carry the body round it at the slider's speed, the body always facing it, alike at every rate;
//  - the pose: the clip's time by the way climbed (forward up, backward down), the hands on the pole's axis and the feet on its
//    sides, frame by frame while moving, at 30 and 240;
//  - the camera: the pole held never stops it (`barCamera` 'pass'), a wall beside it still does;
//  - the wall climb never takes a pole while poles are on; with `climb.poles` at 'off' nothing of it runs and the wall climb takes
//    it as before; and the hand-overs only the game makes, pinned as text.
//
// Run: node tools/swg/tests/climbPoles.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { figure, drawPoleFrame, HAVE_BODY, type Figure } from './climbFigure.ts';

const { RAPIER, FIXED_DT } = await import('../../../src/core/physics.ts');
const { TestBody, box, trunk, ground, makePhysics } = await import('./grappleBody.ts');
const { CLIMB_TUNE, CLIMB_POLES_BEFORE, climbPolesBefore, climbFb2Before, resetClimbTune, tuneClimb } = await import('../../../src/anim/climbTune.ts');
const { POLE_CLIMB, POLE_CLIP_NAME, POLE_FACTS, POLE_IDS, measurePoleTable } = await import('../../../src/anim/poleClips.ts');
const { POLE_GRAB, POLE_NONE, POLE_ON, POLE_STEP, POLE_TOP } = await import('../../../src/player/poleClimb.ts');
const { BarAxis, isBarCollider, poleAxisOf, POLE_UPRIGHT } = await import('../../../src/player/barShape.ts');
const { poleSession, POLE_TIMELINES } = await import('./climbPolesBody.ts');
const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { standPiece, bodyAt } = await import('./climbCourseBody.ts');
const { REPO } = await import('./oldModules.ts');
type Body = InstanceType<typeof TestBody>;
type Phys = Awaited<ReturnType<typeof makePhysics>>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const DEG = 180 / Math.PI;
resetClimbTune();

// ---- the clip ----------------------------------------------------------------------------------------------------------------
{
  const index = JSON.parse(readFileSync(join(REPO, 'public', 'anims', 'mixamo', 'index.json'), 'utf8')) as { clips: { id: string; frames: number; duration: number; loop: boolean; feet: unknown[]; trimStart: number; speed: number }[] };
  const row = index.clips.find((c) => c.id === POLE_CLIMB);
  ok(!!row && row.frames === 73 && Math.abs(row.duration - 2.4) < 1e-4 && row.loop && row.trimStart === 0 && row.feet.length === 0 && row.speed === 0, `the pack holds the pole's clip, ${POLE_CLIMB}, as the import's report has it: the owner's 73 frames, 2.4 s, a loop, nothing under its feet`);
  const table = readFileSync(join(REPO, 'tools', 'anim', 'mixamoClips.mjs'), 'utf8');
  ok(/\n  climbing_a_rope_1: \{ loop: true, ground: false \},/.test(table), "the import's table has its row: a loop with nothing under its feet (loaded by name, so not marked `use`)");
  ok(POLE_IDS.length === 1 && POLE_IDS[0] === POLE_CLIMB && POLE_CLIP_NAME === `mx_${POLE_CLIMB}`, 'the pole asks the pack for it by its rig name, made once');
  const pack = readFileSync(join(REPO, 'src', 'anim', 'mixamoPack.ts'), 'utf8');
  // (Climbing II, phase 6: the vaults' clips after it.)
  ok(pack.includes('...BAR_IDS, ...ROPE_IDS].concat(POLE_IDS, VAULT_IDS),'), "and the game's pack asks for it after the ropes' (`browserIo`'s `also`)");
}

/** The game's rig with the pole's clip, posed (the tests' figure), and its table measured off it as the player's `animatePole` does. */
const F: Figure = figure();
const PT = measurePoleTable(F.rig as never);
ok(PT !== null, "the pole's clip is fitted to the figure and its table measured off the game's own rig");
const table = PT as NonNullable<typeof PT>;
{
  const M = table.meanPose;
  const tol = HAVE_BODY ? 0.01 : 0.3;
  const hang = M.gy - M.hy;
  const out = M.gz - M.hz;
  ok(Math.abs(M.gy - POLE_FACTS.grip) < tol && Math.abs(hang - POLE_FACTS.hang) < tol && Math.abs(out - POLE_FACTS.out) < tol, `its mean grip ${M.gy.toFixed(3)} m over the rig's root, the hips ${hang.toFixed(3)} m under it and ${out.toFixed(3)} m behind it across the ground (the facts the body hangs by: ${POLE_FACTS.grip}, ${POLE_FACTS.hang}, ${POLE_FACTS.out})`);
  ok(Math.abs(table.rise - POLE_FACTS.climbRise) < tol + (HAVE_BODY ? 0 : 0.1) && Math.abs(table.duration - 2.4) < 1e-4, `the climb: ${table.rise.toFixed(3)} m up the pole a round of its 2.4 s (each hand's pull, the two hands' mean; the fact is ${POLE_FACTS.climbRise})`);
  if (!HAVE_BODY) note('no converted human male: the clip measured on the tests\' own skeleton');
}

// ---- what a pole is ----------------------------------------------------------------------------------------------------------
{
  const p = await makePhysics();
  ground(p, 0);
  const A = new BarAxis();
  const course = box(p, [-0.04, 0, -0.04], [0.04, 6, 0.04], false);
  const mesh = box(p, [2 - 0.04, 0, -0.04], [2 + 0.04, 6, 0.04], true);
  const cyl = trunk(p, 4, 0, 0.05, 0, 3);
  const cap = p.world.createCollider(RAPIER.ColliderDesc.capsule(1.2, 0.05).setTranslation(6, 1.25, 0));
  const thick = box(p, [8 - 0.1, 0, -0.1], [8 + 0.1, 6, 0.1], false);
  const short = box(p, [10 - 0.04, 0, -0.04], [10 + 0.04, 1.2, 0.04], false);
  const bar = box(p, [12, 2, -0.04], [16, 2.08, 0.04], false);
  const lean = (deg: number, x: number) => p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.04, 3, 0.04).setTranslation(x, 3, 0).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg / DEG)));
  const lean5 = lean(POLE_UPRIGHT / 2, 18);
  const lean15 = lean(POLE_UPRIGHT * 1.5, 20);
  p.stepOnce();
  const axisOk = poleAxisOf(course as never, A) && Math.abs(A.ay) < 1e-6 && Math.abs(A.ay + A.uy * A.len - 6) < 1e-6 && Math.abs(A.len - 6) < 1e-6 && Math.abs(A.thick - 0.08) < 1e-6 && A.uy > 0.999 && A.col === (course as never);
  ok(axisOk, `a still box 0.08 m across and 6 m tall is a pole: its axis from its foot at nought up 6 m, 0.08 across (the course's)`);
  ok(poleAxisOf(mesh as never, A) && poleAxisOf(cyl as never, A) && Math.abs(A.len - 3) < 1e-6 && poleAxisOf(cap as never, A) && Math.abs(A.len - 2.5) < 1e-6, 'and so is a mesh of that shape (a placed row\'s), a cylinder (a trunk) and a capsule, each read off its own shape');
  ok(!poleAxisOf(thick as never, A) && !poleAxisOf(short as never, A) && !poleAxisOf(bar as never, A) && isBarCollider(bar as never), `never one thicker than poleThin (${CLIMB_TUNE.poleThin}), shorter than poleLength (${CLIMB_TUNE.poleLength}) or a bar, which stays a bar`);
  ok(poleAxisOf(lean5 as never, A) && !poleAxisOf(lean15 as never, A), `a post leaning ${POLE_UPRIGHT / 2} degrees is one, one leaning ${POLE_UPRIGHT * 1.5} is not (within ${POLE_UPRIGHT} of upright)`);
  tuneClimb({ poleThin: 0.05 });
  const thin = poleAxisOf(course as never, A);
  tuneClimb({ poleThin: 0.15, poleLength: 7 });
  const longer = poleAxisOf(course as never, A);
  resetClimbTune();
  ok(!thin && !longer && poleAxisOf(course as never, A), 'the sliders move it live: under a thinner poleThin or a longer poleLength the course\'s pole is none');
}

// ---- grabbing ----------------------------------------------------------------------------------------------------------------
/** A world with flat ground at nought, a pole 0.08 m across and 6 m tall at (0, 3), a body at (0, 0, z0) facing +z. */
async function poleWorld(fps: number, z0 = 2, behind = false): Promise<{ p: Phys; b: Body; pole: RAPIER.Collider }> {
  const p = await makePhysics();
  ground(p, 0);
  const pole = box(p, [-0.04, 0, 3 - 0.04], [0.04, 6, 3 + 0.04], false);
  // (A slab 1.7 m over the ground over the body's side of the pole: the standing body walks under it, the hanging one, lifted off the
  // ground as the clip hangs it, meets it: no room.)
  if (behind) box(p, [-1, 1.7, 2.0], [1, 1.9, 2.9]);
  p.stepOnce();
  (p as unknown as { acc: number }).acc = 0;
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, z0);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  b.run(fps, 0.3);
  return { p, b, pole };
}
{
  const rows: string[] = [];
  let all = true;
  for (const fps of RATES) {
    const { b, pole } = await poleWorld(fps, 2.5);
    b.key('KeyE', true);
    b.run(fps, 0.6);
    b.key('KeyE', false);
    const P = b.pole;
    const facing = Math.abs(Math.atan2(Math.sin(b.heading), Math.cos(b.heading))) * DEG;
    const ax = Math.hypot(b.pos.x, b.pos.z - 3);
    const grip = P.pole.ay + P.pole.uy * P.s;
    const fine = P.holding && P.phase === POLE_ON && P.pole.col === (pole as never) && facing < 0.5 && Math.abs(ax - POLE_FACTS.out) < 0.01 && Math.abs(grip - POLE_FACTS.grip) < 0.02 && Math.abs(b.pos.y + 0.8 - (grip - POLE_FACTS.hang)) < 1e-6;
    all &&= fine;
    rows.push(`${fps}: ${P.holding ? `held, facing ${facing.toFixed(2)} deg off the pole, ${ax.toFixed(3)} m off its axis, grip ${grip.toFixed(3)} m up` : 'not held'}`);
  }
  ok(all, `E standing by a pole grabs it facing it, the body's middle ${POLE_FACTS.out} m off its axis and ${POLE_FACTS.hang} m under the hands, the hands where the clip has them over the feet (${POLE_FACTS.grip} m), at every rate (${rows.join('; ')})`);
  const none = await (async () => {
    const a = await poleWorld(60, 2.5);
    a.b.run(60, 0.6);
    const far = await poleWorld(60, 1.85);
    far.b.key('KeyE', true);
    far.b.run(60, 0.6);
    return !a.b.pole.holding && !far.b.pole.holding && far.b.pole.casts > 0;
  })();
  ok(none, `never without E (nothing asked), and never from 1.15 m off its axis (past the hands' reach, ${CLIMB_TUNE.reachAhead} m and half the pole)`);
  const room = await poleWorld(60, 2.4, true);
  room.b.key('KeyE', true);
  room.b.run(60, 0.6);
  ok(!room.b.pole.holding && room.b.ledgeWords.includes('No room to climb the pole here.'), 'a pole with no room for the hanging body on the body\'s side of it is refused, in words');
  const hook = await poleWorld(60, 2.5);
  hook.b.hooks = true;
  hook.b.hook(0, 8, 2.5, 0, -1, 0, null);
  hook.b.key('KeyE', true);
  hook.b.run(60, 0.4);
  ok(hook.b.grapple.out && !hook.b.pole.holding, 'with the grappling hook\'s rope out the grab is refused, as on a ledge, a bar and a rope');
}

// ---- on the pole (the round's session) ------------------------------------------------------------------------------------------
interface Leg {
  s: number;
  climbed: number;
  turned: number;
  stop: string;
  phase: number;
  y: number;
}
const sessions = new Map<number, { legs: Leg[]; frames: number; maxFacing: number; maxOff: number; loopSign: number; loopBad: number }>();
{
  for (const fps of RATES) {
    const legs: Leg[] = [];
    let maxFacing = 0;
    let maxOff = 0;
    let loopBad = 0;
    let loopSign = 0;
    let lastLoop = Number.NaN;
    let lastClimbed = Number.NaN;
    const h = createHash('sha256');
    const watch = (b: Body) => {
      const P = b.pole;
      if (P.phase !== POLE_ON) return;
      // Facing the pole: the heading against the way from the body's middle to the axis (the drawn heading, at the frame's time).
      const gx = P.pole.ax + P.pole.ux * P.s;
      const gz = P.pole.az + P.pole.uz * P.s;
      const want = Math.atan2(gx - b.pos.x, gz - b.pos.z);
      let d = want - b.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // (The drawn heading leads the body's state by at most the frame's own turn past the last step.)
      maxFacing = Math.max(maxFacing, Math.abs(d) * DEG - Math.abs(P.turnV) * POLE_STEP * DEG);
      maxOff = Math.max(maxOff, Math.abs(Math.hypot(b.pos.x - gx, b.pos.z - gz) - P.out));
      // The clip's phase by the way climbed (no rig here: the share of a round, as `placeFigure` works it).
      const u = (P.climbed / (POLE_FACTS.climbRise * P.k)) % 1;
      const loop = (u < 0 ? u + 1 : u) * 2.4;
      if (lastClimbed === lastClimbed && P.climbed !== lastClimbed) {
        const dl = Math.atan2(Math.sin(((loop - lastLoop) / 2.4) * 2 * Math.PI), Math.cos(((loop - lastLoop) / 2.4) * 2 * Math.PI));
        const sign = Math.sign(dl) * Math.sign(P.climbed - lastClimbed);
        if (sign < 0) loopBad++;
        loopSign += sign;
      }
      lastLoop = loop;
      lastClimbed = P.climbed;
    };
    // Each leg's end noted by its frame (the timeline's own lengths at this rate).
    let frame = 0;
    const ends: number[] = [];
    let acc = 0;
    for (const leg of POLE_TIMELINES.climb) {
      acc += Math.round(leg.seconds * fps);
      ends.push(acc);
    }
    const r = await poleSession('climb', fps, h, (b) => {
      watch(b);
      frame++;
      if (ends.includes(frame)) legs.push({ s: b.pole.s, climbed: b.pole.climbed, turned: b.pole.turned * DEG, stop: b.pole.stop, phase: b.pole.phase, y: b.pos.y });
    });
    if (fps === 60) {
      const h2 = createHash('sha256');
      await poleSession('climb', fps, h2);
      ok(h.digest('hex') === h2.digest('hex'), 'the session is the same twice to the bit');
    }
    sessions.set(fps, { legs, frames: r.frames, maxFacing, maxOff, loopSign, loopBad });
  }
  const s60 = sessions.get(60)!;
  const L = s60.legs;
  const climb = CLIMB_TUNE.poleClimb;
  const rows = [...sessions].map(([fps, s]) => `${fps}: ${s.legs.map((g) => `${g.s.toFixed(3)}${g.stop ? ` ${g.stop}` : ''}`).join(', ')}`);
  ok(L[0].phase === POLE_ON && L.every((g) => g.phase === POLE_ON), `the walk up to the pole with E held grabs it and the body stays on it through every leg (${rows.join('; ')})`);
  const up = L[1].s - L[0].s;
  ok(Math.abs(up - climb * 3.5) < 0.02, `W climbs at the slider's ${climb} m/s: ${up.toFixed(3)} m in 3.5 s`);
  ok(Math.abs(L[2].s - L[1].s) < 1e-9 && Math.abs(L[3].s - L[2].s + climb * 2) < 0.02, `let alone it stays where it is; S climbs down at the same speed (${(L[2].s - L[3].s).toFixed(3)} m in 2 s)`);
  const topS = 6 - POLE_TOP;
  ok(Math.abs(L[8].s - topS) < 1e-9 && L[8].stop === 'top', `W held at the top stops with the hands ${POLE_TOP} m under it (${L[8].s.toFixed(3)} m up), said 'top'`);
  const feetAtBottom = L[9].y;
  ok(L[9].stop === 'bottom' && feetAtBottom > 0.06 && feetAtBottom < 0.12, `S held at the bottom stops clear of the ground under the body (its feet ${feetAtBottom.toFixed(3)} m over it), said 'bottom'`);
  const turn = CLIMB_TUNE.poleTurn;
  ok(Math.abs(L[5].turned + turn * 2) < 0.5 && Math.abs(L[6].turned - L[5].turned - turn) < 0.5 && Math.abs(L[5].s - L[4].s) < 1e-9, `A carries the body round it to its left at the slider's ${turn} degrees a second (${L[5].turned.toFixed(1)} in 2 s) and D back to its right (${(L[6].turned - L[5].turned).toFixed(1)} in 1 s), climbing none`);
  ok([...sessions.values()].every((s) => s.maxFacing < 0.01 && s.maxOff < 1e-6), `the body faces the pole every frame (worst ${Math.max(...[...sessions.values()].map((s) => s.maxFacing)).toFixed(4)} degrees past a frame's own turn) with its middle its own out off the axis`);
  ok([...sessions.values()].every((s) => s.loopBad === 0 && s.loopSign > 0), "the clip's phase follows the way climbed: forward climbing up and backward climbing down, every frame");
  let worst = 0;
  for (const s of sessions.values()) for (let i = 0; i < s.legs.length; i++) worst = Math.max(worst, Math.abs(s.legs[i].s - L[i].s), Math.abs(s.legs[i].turned - L[i].turned) / 100);
  ok(worst < 0.02, `and every leg's end is alike at 30, 60, 144 and 240 frames a second (worst ${worst.toFixed(4)} m, or a hundredth of its degrees)`);
}

// ---- the pose ----------------------------------------------------------------------------------------------------------------
{
  const rows: string[] = [];
  let worstHand = 0;
  let worstFoot = 0;
  let worstGrip = 0;
  for (const fps of [30, 240]) {
    const s = await standPiece(climbCourse({ pieces: ['poles'] }).pieces[0]);
    const { b } = bodyAt(s, 'stand', fps);
    const fig = figure();
    const dt = 1 / fps;
    const gp = new THREE.Vector3();
    let frames = 0;
    let hand = 0;
    let foot = 0;
    let grip = 0;
    const run = (keys: string[], secs: number) => {
      for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyE']) b.key(k, keys.includes(k));
      const n = Math.round(secs * fps);
      for (let i = 0; i < n; i++) {
        b.frame(dt);
        drawPoleFrame(b, fig, dt, table);
        const P = b.pole;
        if (P.phase !== POLE_ON) continue;
        frames++;
        for (let side = 0; side < 2; side++) {
          const g = fig.lp.gripNow(fig.rig as never, side, null, gp);
          if (g) hand = Math.max(hand, Math.hypot(g.x - fig.lp.hand[side * 3], g.y - fig.lp.hand[side * 3 + 1], g.z - fig.lp.hand[side * 3 + 2]));
          // (Each hand's grip on the pole's axis across the ground: what the target says, as drawn.)
          if (g) grip = Math.max(grip, Math.hypot(g.x - P.pole.ax, g.z - P.pole.az));
          const f = fig.lp.ballNow(fig.rig as never, side, null, gp);
          if (f) foot = Math.max(foot, Math.hypot(f.x - fig.lp.foot[side * 3], f.y - fig.lp.foot[side * 3 + 1], f.z - fig.lp.foot[side * 3 + 2]));
        }
      }
    };
    run(['KeyW', 'KeyE'], 1.5);
    run(['KeyW'], 2);
    run([], 0.3);
    run(['KeyS'], 1.5);
    run(['KeyA'], 1);
    run(['KeyD'], 1);
    worstHand = Math.max(worstHand, hand);
    worstFoot = Math.max(worstFoot, foot);
    worstGrip = Math.max(worstGrip, grip);
    rows.push(`${fps}: ${frames} frames, hands ${(hand * 100).toFixed(2)} cm off their places, grips ${(grip * 100).toFixed(2)} cm off the axis, feet ${(foot * 100).toFixed(2)} cm off theirs`);
    b.physics.world.removeRigidBody(b.body);
  }
  ok(worstHand < 0.02 && worstGrip < 0.02, `the figure's hands are on the pole's axis every frame while climbing up, down and round it (${rows.join('; ')})`);
  ok(worstFoot < 0.02, "and its feet on the pole's two sides, pinching it");
}

// ---- the camera ----------------------------------------------------------------------------------------------------------------
{
  const { p, b, pole } = await poleWorld(60, 2.5);
  // A wall to the body's right of the pole (the camera's way to it from there is through it).
  box(p, [-3.1, 0, 0], [-3, 6, 6]);
  p.stepOnce();
  b.key('KeyE', true);
  b.run(60, 0.6);
  b.key('KeyE', false);
  const col = b.pole.cameraCollider();
  ok(b.pole.holding && col === (pole as never) && CLIMB_TUNE.barCamera === 'pass', "on the pole the camera's block leaves out the pole held (`barCamera` 'pass', the game's)");
  const from = { x: 0, y: 2, z: 4.5 };
  const to = { x: 0, y: 2, z: 1 };
  const passes = p.cameraBlock(from, to, b.body, false, col as never);
  const blocks = p.cameraBlock(from, to, b.body, false, null);
  const wall = p.cameraBlock({ x: 0, y: 2, z: 2 }, { x: -4, y: 2, z: 2 }, b.body, false, col as never);
  ok(passes === null && blocks !== null && wall !== null, `a camera ray through the pole held passes it (it met it at ${blocks?.toFixed(2)} m without), and one into the wall beside it still stops (${wall?.toFixed(2)} m)`);
  tuneClimb({ barCamera: 'block' });
  ok(b.pole.cameraCollider() === null, "under 'block' the pole is a wall to the camera, as every bar is");
  resetClimbTune();
  b.key('Space', true);
  b.frame(1 / 60);
  b.key('Space', false);
  // (Maker B: Space jumps off now (`climb.poleJump` 'fly'): in the jump's flight the pole jumped off is still left out, as the bar let
  // go of is; once the flight has ended, nothing is.)
  ok(b.pole.flying && b.pole.cameraCollider() === (pole as never), "jumped off, the pole is still left out while the jump flies");
  let t = 0;
  while (b.pole.holding && t < 3) {
    b.frame(1 / 60);
    t += 1 / 60;
  }
  ok(!b.pole.holding && b.pole.cameraCollider() === null, `let go of (the flight ended '${b.pole.end}' after ${t.toFixed(2)} s), nothing is left out`);
}

// ---- the plain let-go ------------------------------------------------------------------------------------------------------------
{
  // (Maker B: the plain let-go is now the other setting of the round's Space and crouch, `climb.poleJump` 'plain' and
  // `climb.poleCrouch` 'drop'; the jump off and the slide are climbPolesOff.test.ts's.)
  tuneClimb({ poleJump: 'plain', poleCrouch: 'drop' });
  const { b } = await poleWorld(60, 2.5);
  b.key('KeyE', true);
  b.run(60, 0.6);
  b.key('KeyE', false);
  b.key('KeyW', true);
  b.run(60, 2);
  b.key('KeyW', false);
  const y0 = b.pos.y;
  b.key('KeyX', true);
  b.frame(1 / 60);
  b.key('KeyX', false);
  const off = !b.pole.holding;
  b.run(60, 2);
  ok(off && y0 > 1 && b.grounded && b.pos.y < 0.05, `the crouch lets go, straight down, and the body falls to the ground (from ${y0.toFixed(2)} m)`);
  b.key('KeyE', true);
  b.run(60, 0.6);
  ok(b.pole.holding, 'and E grabs the pole again once the let-go\'s regrab has passed');
  b.key('KeyE', false);
  b.key('Space', true);
  b.frame(1 / 60);
  b.key('Space', false);
  ok(!b.pole.holding, 'Space lets go too (the jump off is the round\'s item 3)');
  resetClimbTune();
}

// ---- 'off', the switch's other setting, and the wall climb ---------------------------------------------------------------------
{
  climbFb2Before();
  const viaFb2 = CLIMB_TUNE.poles === 'off';
  resetClimbTune();
  climbPolesBefore();
  const own = CLIMB_TUNE.poles === 'off' && Object.keys(CLIMB_POLES_BEFORE).every((k) => (CLIMB_TUNE as unknown as Record<string, string>)[k] === CLIMB_POLES_BEFORE[k]);
  resetClimbTune();
  ok(viaFb2 && own && CLIMB_TUNE.poles === 'on', "the feedback round II's put back (and so every older round's chain) puts the poles to 'off', the round's own put back too; the game ships them 'on'");
  for (const off of [true, false]) {
    resetClimbTune();
    if (off) tuneClimb({ poles: 'off' });
    const { b } = await poleWorld(60, 2.5);
    b.key('KeyE', true);
    b.key('KeyW', true);
    b.run(60, 2);
    b.key('KeyE', false);
    b.key('KeyW', false);
    if (off) ok(!b.pole.holding && b.pole.casts === 0 && b.pole.grabs === 0 && (b.wall.climbs > 0 || b.ledge.grabs > 0), "under 'off' E and W at a pole take nothing of the pole's, the pole asks the engine nothing, and the wall climb takes it as before");
    else ok(b.pole.holding && b.wall.climbs === 0, "under 'on' the pole takes it and the wall climb never does");
  }
  resetClimbTune();
  // The wall climb's own ask passes a pole under 'on' (`canClimb`, the action bar's: a pole standing in front of nothing is no face).
  const { b } = await poleWorld(60, 2.5);
  b.key('KeyW', true);
  b.run(60, 0.8);
  b.key('KeyW', false);
  const li = (b as unknown as { fillLedgeIn(dt: number, move: null, wasGrounded: boolean): import('../../../src/player/ledge.ts').LedgeIn }).fillLedgeIn(0, null, true);
  li.blocked = true;
  li.use = true;
  const onWall = b.wall.canClimb(b.physics.world as never, b, li);
  tuneClimb({ poles: 'off' });
  const offWall = b.wall.canClimb(b.physics.world as never, b, li);
  resetClimbTune();
  ok(!onWall && offWall, `pressed against the pole, the wall climb finds no face in it under 'on' (it found one under 'off': ${offWall})`);
}

// ---- the hand-overs only the game makes, as text ----------------------------------------------------------------------------------
{
  const read = (p: string) => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
  const player = read('src/player/player.ts');
  const harness = read('tools/swg/tests/grappleBody.ts');
  const main = read('src/main.ts');
  const clips = read('src/player/hangClips.ts');
  const wall = read('src/player/wallClimb.ts');
  const tune = read('src/anim/climbTune.ts');
  const at = (s: string, w: string) => s.indexOf(w);
  ok(at(player, 'if (this.pole.holding) {\n      this.poleFrame(dt, input, cam, world);\n      return;\n    }') > at(player, 'if (this.rope.holding) {\n      this.ropeFrame(dt, input, cam, world);') && at(player, 'if (this.pole.holding) {\n      this.poleFrame(') < at(player, 'if (this.ledge.holding) {\n      this.hangFrame('), 'on a pole the climb has the body in place of the movement, after the rope\'s and before the ledge\'s');
  ok(at(player, 'if (this.sensePole(dt, input, move, wasGrounded, atControls)) {') > at(player, 'if (this.senseRope(dt, input, move, wasGrounded, atControls, cam)) {') && at(player, 'if (this.sensePole(') < at(player, 'if (this.senseLedge(dt, input, move, wasGrounded, atControls)) {'), "the pole's grab after the move comes after the rope's and before the ledges'");
  ok(/li\.busy = this\.swimming \|\| this\.grapple\.out \|\| this\.grapple\.released \|\| this\.flung \|\| this\.hp <= 0 \|\| atControls \|\| this\.prone/.test(player.slice(at(player, '  private sensePole('))) && /li\.busy = this\.swimming \|\| \(this\.hooks && \(g\.out \|\| g\.released\)\)/.test(harness.slice(at(harness, "if (CLIMB_TUNE.poles === 'on') {"))), "the grab is refused with the hook's rope out, swimming, thrown, dead, at the controls or prone (the game's and the harness's)");
  ok(/\/\/ \(Climbing II, phase 5: and on a pole\.\)\n    if \(this\.pole\.holding\) return true;\n    return this\.ledge\.holding/.test(player), 'on a pole the hands are full: the fight muted and the hook refused (`climbHolds`)');
  ok(/this\.reachPole = this\.pole\.canGrab\(this\.physics\.world as unknown as PoleWorld, this, li\);\r?\n    if \(this\.reachPole\) return true;/.test(player.slice(at(player, '  climbReach(): boolean {'))), "a pole in reach is the use key's climb (`climbReach`, the action bar's and the falling E's; maker B: kept as a pole, for its word)");
  ok(/P\.steps = this\.physics\.stepsAhead\(dt\);\n    P\.behind = this\.physics\.behind;\n    P\.step\(this\.physics\.world as unknown as PoleWorld, this, li\);/.test(player) && /P\.steps = this\.physics\.stepsAhead\(dt\);\n    P\.behind = this\.physics\.behind;\n    P\.step\(this\.physics\.world as unknown as PoleWorld, this, this\.fillLedgeIn\(dt, null, false\)\);/.test(harness), "the climb is stepped on the physics' own coming steps, the game's and the harness's alike");
  ok(/this\.pole\.placeFigure\(this\.poleTableRig === rig \? this\.poleTable : null, rig\.root\.scale\.y, this\.pos\);\n    drivePoleClips\(rig, this\.pole, dt, this\.hangClips\);/.test(player) && /const T = measurePoleTable\(rig\);/.test(player), "the figure placed by the clip's table measured off its own rig, and the clip put on the rig");
  ok(/this\.animatePole\(dt\);\n    this\.placeVisual\(\);\n    this\.placePoleLimbs\(\);/.test(player) && /P\.limbsFor\(lp, rig, toPhys\);\n    if \(show\) lp\.place\(rig, null, toPhys\);/.test(player), 'the hands and feet put on the pole after the figure is placed, by the limbs\' own solve');
  ok(/rig\.root\.position\.x = P\.offX \* c - P\.offZ \* s;\n    rig\.root\.position\.y \+= P\.offY;\n    rig\.root\.position\.z = P\.offX \* s \+ P\.offZ \* c;/.test(player), "the rig's root put where the pole draws the figure");
  ok(/releasePoleClip\(this\.rig, this\.pole\);\n    this\.pole\.tick\(dt\);/.test(player) && /this\.pole\.tick\(dt\);/.test(harness), "off the pole, a let-go's clip let go of and the pole's clocks stepped");
  ok(/this\.pole\.reset\('stood elsewhere'\);/.test(player) && /if \(this\.pole\.holding\) this\.pole\.reset\('off the feet'\);/.test(player) && /this\.pole\.reset\('stood elsewhere'\);/.test(harness), 'stood elsewhere or off the feet, the pole lets go');
  ok(/if \(this\.pole\.holding\) return this\.pole\.cameraCollider\(\) as unknown as RAPIER\.Collider \| null;\r?\n    return this\.bar\.cameraCollider\(\)/.test(player) && main.includes('(from, to) => this.physics.cameraBlock(from, to, player.body, this.world.inside, player.barCamera())'), "the camera's own call hands it the pole held (through the player's `barCamera`)");
  ok(/rig\.timeAt = P\.loopT;\n      rig\.setTimeNow\(POLE_CLIP_NAME\);/.test(clips) && /rig\.prefer\('hangFree', POLE_CLIP_NAME\);/.test(clips), "the pole's clip put at its time through the rig's own field, its name made once");
  ok(/if \(CLIMB_TUNE\.poles === 'on' && isPoleCollider\(h\.collider as unknown as BarCollider\)\) return false;/.test(wall), "the wall climb's rays pass a pole while poles are on");
  ok(/export function climbFb2Before\(\): void \{\n  \/\/ [^\n]*\n  climbPolesBefore\(\);/.test(tune), "the feedback round II's put back calls phase 5's first");
  ok(/pole: p\.pole\.report\(\),/.test(main) && /if \(o\.letGo && p\.pole\.holding\) p\.pole\.letGo\(p as never\);/.test(main), '`__debug.climb()` reports the pole and lets go of it');
}

resetClimbTune();
console.log(`climbPoles: ${checks} checks passed`);
