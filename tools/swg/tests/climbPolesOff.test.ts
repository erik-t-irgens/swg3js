// Climbing II, phase 5 (poles), maker B: items 3 and 4, off the pole, through the game's own movement and climbing on the real Rapier
// (the grapple's harness, tools/swg/tests/grappleBody.ts, which steps the pole, its catcher's bars and ledges and the hand-overs in
// the player's own places), frame by frame while moving, at 30, 60, 144 and 240 frames a second:
//  - Space jumps off along the view (`climb.poleJump` 'fly'), flown on the physics' own steps, and is caught on the way by another
//    pole (the course's `poles`, 2 m apart: the brief's proof), a bar (handed to the bars with the frame's steps left), a lip (handed
//    to the ledges); with nothing in reach it lands, and into a wall it ends there; the push and the height are live sliders;
//  - the crouch slides down (`climb.poleCrouch` 'slide') at `poleSlide`, the clip held still, to the ground (stood) or off a pole's
//    foot in the air (dropped); the crouch again lets go, W stops the slide;
//  - W at the top (`climb.poleTop` 'climb') climbs onto the platform beside a pole and out of a floor's hole (the poles' tops' row),
//    and a pole with nothing at its top stays held at the top;
//  - everything else, as the bars': a hard blow knocks the body off, a smaller one does not; the feet in the water let go into the
//    swim, a flight into the water ends; the camera passes the pole jumped off while the jump flies and the pole caught; another
//    player's game is told a free hang's hands on the pole; the action bar's words; each switch's other setting is maker A's let-go
//    or stop; and the game's own lines pinned as text against the harness's.
//
// Run: node tools/swg/tests/climbPolesOff.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLIMB_POLES_BEFORE, CLIMB_TUNE, climbPolesBefore, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { climbCourse, POLE_TOP_FLOOR, POLE_TOP_LIP } from '../../../src/anim/climbCourse.ts';
import { pieceLabel } from '../../../src/anim/climbLabels.ts';
import { courseWayToWorld } from '../../../src/anim/climbCourseBuild.ts';
import { POLE_FLY, POLE_NONE, POLE_ON } from '../../../src/player/poleClimb.ts';
import { LEDGE_FACTS, LEDGE_REST, LEDGE_ROLES } from '../../../src/anim/ledgeClips.ts';
import { fillActions, newPromptActions, newPromptState, PROMPT_WORDS } from '../../../src/ui/promptRules.ts';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';
import { RATES, bodyAt, standPiece } from './climbCourseBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const f3 = (v: number) => v.toFixed(3);
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** Frames at `fps` for `seconds`, keys as they are. */
function run(b: TestBody, fps: number, seconds: number, until: (() => boolean) | null = null): number {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    b.frame(1 / fps);
    if (until && until()) return (i + 1) / fps;
  }
  return Infinity;
}
function tapKey(b: TestBody, code: string, fps: number): void {
  b.key(code, true);
  b.frame(1 / fps);
  b.key(code, false);
}

/** A body half a metre in front of a pole at (0, z 3), the pole `h` tall from `foot` up, facing it, the view the way it faces; more boxes by `more`. */
async function poleWorld(fps: number, o: { h?: number; foot?: number; more?: (p: Awaited<ReturnType<typeof makePhysics>>) => void } = {}) {
  const p = await makePhysics();
  ground(p, 0);
  const foot = o.foot ?? 0;
  const pole = box(p, [-0.04, foot, 3 - 0.04], [0.04, foot + (o.h ?? 6), 3 + 0.04], false);
  o.more?.(p);
  p.stepOnce();
  (p as unknown as { acc: number }).acc = 0;
  const b = new TestBody(p);
  b.jka.forceLevel = 0;
  b.place(0, 0, 2.5);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  b.run(fps, 0.3);
  return { p, b, pole };
}
/** Grabbed (E held a moment) and climbed `up` seconds. */
function grabAndClimb(b: TestBody, fps: number, up: number): void {
  b.key('KeyE', true);
  run(b, fps, 0.6);
  b.key('KeyE', false);
  if (up > 0) {
    b.key('KeyW', true);
    run(b, fps, up);
    b.key('KeyW', false);
  }
}
/** The view turned to a world way (the jump off's), the move keys' frame with it. */
function look(b: TestBody, x: number, z: number): void {
  const l = Math.hypot(x, z);
  b.forward.set(x / l, 0, z / l);
  b.right.set(-z / l, 0, x / l);
}

// ---- the brief's proof: one pole to the other, 2 m apart, caught on the way, alike at every rate -------------------------------------
{
  const rows: string[] = [];
  const caughtAt: { s: number; phi: number; t: number; x: number; y: number; z: number }[] = [];
  let all = true;
  let reachOk = true;
  for (const fps of RATES) {
    const s = await standPiece(climbCourse({ pieces: ['poles'] }).pieces[0]);
    const { b } = bodyAt(s, 'stand', fps);
    b.key('KeyW', true);
    b.key('KeyE', true);
    run(b, fps, 1.5);
    b.key('KeyE', false);
    run(b, fps, 2);
    b.key('KeyW', false);
    const held = b.pole.phase === POLE_ON;
    const right = courseWayToWorld(s.frame, 1, 0, { x: 0, z: 0 });
    look(b, right.x, right.z);
    run(b, fps, 0.3);
    const col0 = b.pole.pole.col;
    tapKey(b, 'Space', fps);
    const flew = b.pole.phase === POLE_FLY && b.pole.cameraCollider() === col0;
    let leftOut = flew;
    const t = run(b, fps, 2, () => {
      if (b.pole.phase === POLE_FLY) leftOut &&= b.pole.cameraCollider() === col0;
      return b.pole.phase !== POLE_FLY;
    });
    const P = b.pole;
    const caught = P.holding && P.pole.col !== col0 && P.catches === 1 && P.end === 'caught';
    // (The fixer: the caught pole's drawn carry begun on the frame's own time, whatever the catcher wrote into the frame's record.)
    reachOk &&= Math.abs(P.reachT - 1 / fps) < 1e-12;
    run(b, fps, 0.4);
    const passesNew = P.cameraCollider() === P.pole.col && P.pole.col !== col0;
    caughtAt.push({ s: P.s, phi: P.phi, t, x: b.pos.x, y: b.pos.y, z: b.pos.z });
    all &&= held && flew && leftOut && caught && passesNew;
    rows.push(`${fps}: caught after ${t.toFixed(3)} s at ${f3(P.s)} up, round ${((P.phi * 180) / Math.PI).toFixed(1)} degrees`);
    b.physics.world.removeRigidBody(b.body);
  }
  ok(all, `on the course's poles every rate jumps off the left pole along the view to the right one 2 m off (Space, \`climb.poleJump\` 'fly') and is caught on the way, the pole jumped off left out of the camera's block while the jump flies and the pole caught left out after (${rows.join('; ')})`);
  const ds = Math.max(...caughtAt.map((c) => Math.abs(c.s - caughtAt[1].s)));
  const dp = Math.max(...caughtAt.map((c) => Math.hypot(c.x - caughtAt[1].x, c.y - caughtAt[1].y, c.z - caughtAt[1].z)));
  const dt = Math.max(...caughtAt.map((c) => Math.abs(c.t - caughtAt[1].t)));
  ok(reachOk, "the caught pole's drawn carry begins on the frame's own time at every rate (the catch's frame counts its own step, never the catcher's record's)");
  ok(ds < 0.03 && dp < 0.03, `the catch is alike at every rate (on the physics' own steps): the grip up the pole within ${(ds * 100).toFixed(2)} cm and the body's place 0.4 s on within ${(dp * 100).toFixed(2)} cm of 60's, the catch's moment within ${(dt * 1000).toFixed(0)} ms (a frame's own)`);
}

// ---- the flight: its push and its height are the sliders', on the physics' own steps -----------------------------------------------
{
  const tops: string[] = [];
  let allOk = true;
  for (const [push, up] of [
    [3, 0.5],
    [2, 1],
    [0, 0.5],
  ] as const) {
    resetClimbTune();
    tuneClimb({ polePush: push, poleJumpUp: up });
    for (const fps of [30, 240]) {
      const { b } = await poleWorld(fps, { h: 8 });
      grabAndClimb(b, fps, 2);
      // Looking back, away from the pole (the body faces +z, the pole ahead: the view along -z).
      look(b, 0, -1);
      const y0 = b.pos.y;
      const z0 = b.pos.z;
      tapKey(b, 'Space', fps);
      let topY = b.pos.y;
      run(b, fps, 3, () => {
        topY = Math.max(topY, b.pos.y);
        return !b.pole.holding;
      });
      const rose = topY - y0;
      const v = b.pole;
      allOk &&= Math.abs(rose - up) < 0.03 && v.end === 'land' && Math.abs(v.vz + push) < 1e-9;
      if (fps === 30) tops.push(`push ${push} m/s and ${up} m up: rose ${f3(rose)} m, landed ${f3(z0 - b.pos.z)} m out, ended '${v.end}'`);
      b.physics.world.removeRigidBody(b.body);
    }
  }
  resetClimbTune();
  ok(allOk, `a jump off with nothing in reach flies the parabola its sliders give (\`polePush\` across, \`poleJumpUp\` up, the flight's own gravity) and lands, alike at 30 and 240 (${tops.join('; ')})`);
}

// ---- the fixer: the jump's way never through the pole held (the chase view looks at the pole) ------------------------------------
{
  const rows: string[] = [];
  let through = true;
  let ways = true;
  const deg = Math.PI / 180;
  for (const fps of RATES) {
    for (const [name, vx, vz, wantX, wantZ] of [
      // The view straight at the pole (the body faces +z, the pole at z 3 ahead): straight off it, back along -z.
      ['at the pole', 0, 1, 0, -1],
      // 30 degrees off it: the share toward the pole turned away (mirrored), the share across kept.
      ['30 degrees off it', Math.sin(30 * deg), Math.cos(30 * deg), Math.sin(30 * deg), -Math.cos(30 * deg)],
      // Square to the body's side, and away from the pole: as the view is.
      ['square to it', 1, 0, 1, 0],
      ['away from it', 0, -1, 0, -1],
    ] as const) {
      const { b } = await poleWorld(fps);
      grabAndClimb(b, fps, 1.5);
      const P = b.pole;
      const out = P.out;
      look(b, vx, vz);
      // (The body's side as it hangs: the grab stands it a few micrometres off the line the test lays, so the way is worked out
      // from it exactly, and held to the nominal way within a millimetre a metre.)
      const ax = Math.sin(P.phi);
      const az = Math.cos(P.phi);
      const l = Math.hypot(vx, vz);
      let ex = vx / l;
      let ez = vz / l;
      const dd = ex * ax + ez * az;
      if (dd < 0) {
        ex -= 2 * dd * ax;
        ez -= 2 * dd * az;
      }
      tapKey(b, 'Space', fps);
      const push = CLIMB_TUNE.polePush;
      const way = P.phase === POLE_FLY && Math.abs(P.vx - push * ex) < 1e-9 && Math.abs(P.vz - push * ez) < 1e-9 && Math.abs(P.vx - push * wantX) < push * 1e-3 && Math.abs(P.vz - push * wantZ) < push * 1e-3;
      // The body's middle never nearer the pole's axis (0, z 3) across the ground than where it hung, all the flight long.
      let near = Math.hypot(b.pos.x, b.pos.z - 3);
      run(b, fps, 3, () => {
        near = Math.min(near, Math.hypot(b.pos.x, b.pos.z - 3));
        return !P.holding;
      });
      run(b, fps, 0.5);
      // (Ending no further toward the pole's far side than it hung: z 3 less the hang's `out`.)
      const clear = near >= out - 1e-6 && b.pos.z < 3 - out + 0.01;
      ways &&= way;
      through &&= clear;
      if (fps === 30 || fps === 144) rows.push(`${fps} ${name}: way (${f3(P.vx / push)}, ${f3(P.vz / push)}), nearest the axis ${f3(near)} m (hung ${f3(out)}), ended '${P.end}' at z ${f3(b.pos.z)}`);
      b.physics.world.removeRigidBody(b.body);
    }
  }
  ok(ways, "Space jumps off along the view where the view runs across the pole or away from it, and turns a view's share toward the pole away from it (mirrored across the body's side: a view straight at the pole pushes straight off it), at every rate");
  ok(through, `and so the body never passes through the pole it held (the flight's sweep leaves that pole out): its middle never nearer the axis than where it hung, ending on its own side, at every rate (${rows.join('; ')})`);
}

// ---- the fixer: the figure's turn and the let-go's ease in a jump's flight run on the frame's own time, alike at every rate --------
// (A catcher asked on the flight's steps writes the player's one kept frame record with a physics step's time: the flight's frame
// reads its own step, `dtNow`, never the record's.)
{
  const rows: string[] = [];
  let all = true;
  let asked = true;
  const at = new Map<number, number>();
  for (const fps of RATES) {
    const { b } = await poleWorld(fps);
    grabAndClimb(b, fps, 1.5);
    // Counted where the harness's catcher asks the bars (the bars' grab, through the catcher's own frame record).
    let asks = 0;
    const bb = b as unknown as { poleCatchBar: () => boolean };
    const own = bb.poleCatchBar.bind(b);
    bb.poleCatchBar = () => {
      asks++;
      return own();
    };
    look(b, 1, 0);
    const P = b.pole;
    const h0 = P.heading;
    tapKey(b, 'Space', fps);
    const headTo = Math.atan2(P.vx, P.vz);
    let d0 = headTo - h0;
    if (d0 > Math.PI) d0 -= 2 * Math.PI;
    else if (d0 <= -Math.PI) d0 += 2 * Math.PI;
    const e = CLIMB_TUNE.ease;
    let worst = 0;
    let worstOut = 0;
    let k = 1;
    const check = () => {
      const t = k / fps;
      const want = headTo - d0 * Math.exp(-t / e);
      worst = Math.max(worst, Math.abs(P.heading - want));
      worstOut = Math.max(worstOut, Math.abs(P.outT - Math.max(0, e - t)));
      if (k === fps / 6) at.set(fps, P.heading);
    };
    check();
    while (P.phase === POLE_FLY && k < 3 * fps) {
      b.frame(1 / fps);
      k++;
      if (P.phase === POLE_FLY) check();
    }
    all &&= worst < 1e-9 && worstOut < 1e-9 && asks > 0;
    asked &&= asks > 0;
    rows.push(`${fps}: the turn within ${worst.toExponential(1)} rad and the ease within ${worstOut.toExponential(1)} s of the frame's own time, the bars asked ${asks} times`);
    b.physics.world.removeRigidBody(b.body);
  }
  const hs = [...at.values()];
  const spread = Math.max(...hs) - Math.min(...hs);
  ok(asked, 'a jump off sideways with nothing in reach asks the catcher on its steps (the bars, through the frame record the flight shares)');
  ok(all && hs.length === RATES.length && spread < 1e-9, `and the figure's turn toward the flight's way and the let-go's offset ease run on the frame's own time at every rate, the heading a sixth of a second in alike to ${spread.toExponential(1)} rad (${rows.join('; ')})`);
}

// ---- the fixer: a pole caught on a later step of a frame whose earlier step asked the catcher begins its carry on the frame's time --
// (At 30 a second a jump pushed off at 2 m/s to a pole 2 m off is caught on the frame's second step, its first having asked the bars.)
{
  const rows: string[] = [];
  let all = true;
  resetClimbTune();
  tuneClimb({ polePush: 2 });
  for (const fps of RATES) {
    const { b } = await poleWorld(fps, { more: (p) => box(p, [2 - 0.04, 0, 3 - 0.04], [2 + 0.04, 6, 3 + 0.04], false) });
    grabAndClimb(b, fps, 1.5);
    look(b, 1, 0);
    tapKey(b, 'Space', fps);
    const P = b.pole;
    run(b, fps, 2, () => P.phase !== POLE_FLY);
    const ok1 = P.end === 'caught' && P.catches === 1 && Math.abs(P.reachT - 1 / fps) < 1e-12;
    all &&= ok1;
    rows.push(`${fps}: ended '${P.end}', the carry ${(P.reachT * 1000).toFixed(2)} ms in on the catch's frame`);
    b.physics.world.removeRigidBody(b.body);
  }
  resetClimbTune();
  ok(all, `a pole caught in a jump's flight begins its drawn carry on the frame's own step at every rate (${rows.join('; ')})`);
}

// ---- the fixer: the course's pole label follows `climb.poles` (its other setting the base commit's words) --------------------------
{
  const poles = climbCourse({ pieces: ['poles'] }).pieces[0];
  resetClimbTune();
  tuneClimb({ poles: 'off' });
  const off = pieceLabel(poles);
  resetClimbTune();
  const on = pieceLabel(poles);
  ok(off.title === 'Poles (phase 5)' && off.what === 'Poles come with phase 5', `under \`climb.poles\` 'off' the course's poles say what \`5421344\` said ("${off.title}" / "${off.what}"), the wall climb taking them`);
  ok(/^Poles \d/.test(on.title) && on.what.startsWith('E grabs a pole'), `and under 'on' what to try on them ("${on.title}")`);
}

// ---- a wall in the way, a bar in reach, a lip in reach ---------------------------------------------------------------------------
{
  const rows: string[] = [];
  let wallOk = true;
  let barOk = true;
  let lipOk = true;
  const barAt: number[] = [];
  for (const fps of RATES) {
    // A wall 1.2 m behind the body: the flight ends against it, handed to the movement.
    {
      const { b } = await poleWorld(fps, { more: (p) => box(p, [-2, 0, 1.0], [2, 6, 1.2]) });
      grabAndClimb(b, fps, 1.5);
      look(b, 0, -1);
      tapKey(b, 'Space', fps);
      run(b, fps, 2, () => !b.pole.holding);
      wallOk &&= b.pole.end === 'wall' && !b.pole.holding && b.pos.z > 1.2;
      if (fps === 60) rows.push(`a wall behind: ended '${b.pole.end}' at z ${f3(b.pos.z)}`);
      b.physics.world.removeRigidBody(b.body);
    }
    // A bar across the way 1.4 m behind, a little over the hands: caught by the bars' own grab, the frame's steps left handed on.
    {
      const { b } = await poleWorld(fps, { more: (p) => box(p, [-2, 3.665, 1.365], [2, 3.735, 1.435]) });
      grabAndClimb(b, fps, 1.5);
      look(b, 0, -1);
      tapKey(b, 'Space', fps);
      run(b, fps, 2, () => !b.pole.holding);
      run(b, fps, 0.3);
      barOk &&= b.bar.holding && b.pole.barCatches === 1 && b.pole.end === 'bar' && b.pole.phase === POLE_NONE;
      barAt.push(b.bar.s);
      if (fps === 60) rows.push(`a bar behind: ended '${b.pole.end}', the bar holds (${b.bar.holding}), its swing ${((b.bar.th * 180) / Math.PI).toFixed(1)} degrees`);
      b.physics.world.removeRigidBody(b.body);
    }
    // A lip behind: a wall whose top stands a little over the hands 1.9 m behind; caught by the ledges' own grab.
    {
      const { b } = await poleWorld(fps, { more: (p) => box(p, [-2, 0, -1.0], [2, 3.6, 0.9]) });
      grabAndClimb(b, fps, 1.5);
      look(b, 0, -1);
      tapKey(b, 'Space', fps);
      run(b, fps, 2, () => !b.pole.holding);
      run(b, fps, 0.5);
      lipOk &&= b.ledge.holding && b.pole.lipCatches === 1 && b.pole.end === 'lip';
      if (fps === 60) rows.push(`a lip behind: ended '${b.pole.end}', the ledge holds (${b.ledge.holding})`);
      b.physics.world.removeRigidBody(b.body);
    }
  }
  ok(wallOk, `a jump into a wall ends against it and is the movement's from there, at every rate (${rows[0]})`);
  ok(barOk, `a bar in reach on the way is caught by the bars' own grab (the use key handed to them as a hop's catch: no key pressed), at every rate (${rows[1]})`);
  ok(Math.max(...barAt) - Math.min(...barAt) < 0.03, `and caught alike at every rate, the frame's steps the flight left handed to the bar's swing (the hands along the bar within ${((Math.max(...barAt) - Math.min(...barAt)) * 100).toFixed(2)} cm)`);
  ok(lipOk, `a lip in reach on the way is caught by the ledges' own grab, at every rate (${rows[2]})`);
}

// ---- the slide down ----------------------------------------------------------------------------------------------------------------
{
  const rows: string[] = [];
  let all = true;
  for (const fps of RATES) {
    const { b } = await poleWorld(fps);
    grabAndClimb(b, fps, 3);
    const y0 = b.pos.y;
    const clip0 = b.pole.climbed;
    tapKey(b, 'KeyX', fps);
    const sliding = b.pole.sliding;
    // The speed over a quarter second of it, and the clip held still.
    const ya = b.pos.y;
    run(b, fps, 0.25);
    const v = (ya - b.pos.y) / (Math.round(0.25 * fps) / fps);
    const still = b.pole.climbed === clip0;
    const t = run(b, fps, 4, () => !b.pole.holding);
    run(b, fps, 0.5);
    // (Stood: the feet within the controller's own skin and settle of the ground, as the plain let-go's.)
    const stood = b.grounded && Math.abs(b.pos.y) < 0.08 && b.pole.end === 'slid' && b.pole.slides === 1;
    all &&= sliding && still && Math.abs(v - CLIMB_TUNE.poleSlide) < 0.25 && stood;
    rows.push(`${fps}: from ${f3(y0)} m at ${v.toFixed(2)} m/s, let go after ${(t + 0.25).toFixed(2)} s, stood at ${f3(b.pos.y)}`);
    b.physics.world.removeRigidBody(b.body);
  }
  ok(all, `the crouch slides the body down the pole at \`poleSlide\` (${CLIMB_TUNE.poleSlide} m/s), the clip held still, and lets go at its foot onto the ground, stood, at every rate (${rows.join('; ')})`);
  // The crouch again lets go at once; W stops the slide; a pole whose foot is in the air: dropped off it.
  {
    const { b } = await poleWorld(60);
    grabAndClimb(b, 60, 3);
    tapKey(b, 'KeyX', 60);
    run(b, 60, 0.2);
    tapKey(b, 'KeyX', 60);
    const again = !b.pole.holding && b.pole.end === 'let go';
    b.physics.world.removeRigidBody(b.body);
    const w = await poleWorld(60);
    grabAndClimb(w.b, 60, 3);
    tapKey(w.b, 'KeyX', 60);
    run(w.b, 60, 0.2);
    tapKey(w.b, 'KeyW', 60);
    const yStop = w.b.pos.y;
    run(w.b, 60, 0.5);
    const stopped = w.b.pole.holding && !w.b.pole.sliding && Math.abs(w.b.pos.y - yStop) < 1e-9;
    w.b.physics.world.removeRigidBody(w.b.body);
    // A pole from 3 m up to 9 m (hung from above: its foot in the air), grabbed falling past it.
    const h = await poleWorld(60, { foot: 3, h: 6 });
    h.b.place(0, 4, 2.9);
    h.b.key('KeyE', true);
    run(h.b, 60, 0.5);
    h.b.key('KeyE', false);
    const onHung = h.b.pole.holding;
    tapKey(h.b, 'KeyX', 60);
    run(h.b, 60, 3, () => !h.b.pole.holding);
    const droppedAt = h.b.pos.y;
    run(h.b, 60, 2);
    const dropped = onHung && h.b.pole.end === 'slid' && droppedAt > 1.5 && h.b.grounded && h.b.pos.y < 0.05;
    h.b.physics.world.removeRigidBody(h.b.body);
    ok(again && stopped && dropped, `the crouch again while sliding lets go at once ('${again}'); W stops the slide where it is (${stopped}); off a pole whose foot is in the air the slide drops off its foot (let go at ${f3(droppedAt)} m, then fell to the ground)`);
  }
}

// ---- the climb onto the top -------------------------------------------------------------------------------------------------------
{
  const rows: string[] = [];
  let all = true;
  for (const [id, top, view] of [
    ['pole-top-lip', POLE_TOP_LIP, [0, 1]],
    ['pole-top-floor', POLE_TOP_FLOOR, [0, -1]],
  ] as const) {
    const ends: number[] = [];
    for (const fps of RATES) {
      const s = await standPiece(climbCourse({ pieces: [id], poleTops: true }).pieces[0]);
      const { b } = bodyAt(s, 'stand', fps);
      const floorY = b.pos.y;
      b.key('KeyW', true);
      b.key('KeyE', true);
      run(b, fps, 1);
      b.key('KeyE', false);
      const way = courseWayToWorld(s.frame, view[0], view[1], { x: 0, z: 0 });
      look(b, way.x, way.z);
      const t = run(b, fps, 6, () => b.ledge.climbsFrom === 1);
      b.key('KeyW', false);
      const took = run(b, fps, 5, () => !b.ledge.holding);
      run(b, fps, 0.3);
      const stood = !b.ledge.holding && !b.pole.holding && b.grounded && Math.abs(b.pos.y - (floorY + top)) < 0.05 && b.pole.tops === 1 && b.pole.end === 'top';
      all &&= stood;
      ends.push(b.pos.y - floorY);
      if (fps === 60 || fps === 240 || !stood) rows.push(`${id} at ${fps}: the climb began ${t.toFixed(2)} s into W and took ${took.toFixed(2)} s, stood at ${f3(b.pos.y - floorY)} m${stood ? '' : ` (ledge ${b.ledge.holding}, pole ${b.pole.holding}, grounded ${b.grounded}, tops ${b.pole.tops}, '${b.pole.end}')`}`);
      b.physics.world.removeRigidBody(b.body);
    }
    all &&= Math.max(...ends) - Math.min(...ends) < 0.03;
  }
  ok(all, `W at a pole's top climbs onto the platform beside it (the lip behind the body) and out of a floor's hole by the ledges' own climb up, the pole left out of its room tests, standing at the top, alike at every rate (${rows.join('; ')})`);
  // A pole with nothing at its top: held at the top, W held on, nothing climbed onto.
  const { b } = await poleWorld(60, { h: 4 });
  grabAndClimb(b, 60, 6);
  ok(b.pole.holding && b.pole.stop === 'top' && b.ledge.climbsFrom === 0 && b.pole.tops === 0, "a pole with nothing at its top: W held there keeps the body on it at the top, nothing climbed onto");
  b.physics.world.removeRigidBody(b.body);
}

// ---- a blow, the water ------------------------------------------------------------------------------------------------------------
{
  let knockOk = true;
  let swimOk = true;
  const rows: string[] = [];
  for (const fps of RATES) {
    const { b } = await poleWorld(fps);
    grabAndClimb(b, fps, 1);
    b.takeDamage(10, false, 'blow');
    run(b, fps, 0.2);
    const kept = b.pole.holding;
    b.takeDamage(CLIMB_TUNE.barKnock, false, 'blow');
    run(b, fps, 0.2);
    knockOk &&= kept && !b.pole.holding && b.pole.end === 'knocked';
    b.physics.world.removeRigidBody(b.body);
    // The water 1.4 m up round the pole: a climb down into it lets go into the swim.
    const w = await poleWorld(fps);
    grabAndClimb(w.b, fps, 2);
    w.b.surface = () => 1.4;
    w.b.key('KeyS', true);
    run(w.b, fps, 4, () => !w.b.pole.holding);
    w.b.key('KeyS', false);
    swimOk &&= !w.b.pole.holding && w.b.pole.end === 'swim';
    if (fps === 60) rows.push(`let go at feet ${f3(w.b.pos.y)} under the surface's 1.4`);
    w.b.physics.world.removeRigidBody(w.b.body);
  }
  ok(knockOk, `a blow of climb.barKnock (${CLIMB_TUNE.barKnock}) or more knocks the body off the pole, straight down; a smaller one keeps it, at every rate`);
  ok(swimOk, `the feet in the water let go of the pole into the swim, at every rate (${rows.join('')})`);
  // A jump off into the water: the flight ends there.
  const j = await poleWorld(60, { h: 8 });
  grabAndClimb(j.b, 60, 1);
  j.b.surface = () => 1.4;
  look(j.b, 0, -1);
  tapKey(j.b, 'Space', 60);
  run(j.b, 60, 3, () => !j.b.pole.holding);
  ok(j.b.pole.end === 'water' || j.b.pole.end === 'swim', `a jump off into the water ends there, handed to the swim ('${j.b.pole.end}')`);
  j.b.physics.world.removeRigidBody(j.b.body);
}

// ---- the other settings: maker A's let-go and stop ---------------------------------------------------------------------------------
{
  resetClimbTune();
  climbPolesBefore();
  const own = CLIMB_POLES_BEFORE.poleJump === 'plain' && CLIMB_POLES_BEFORE.poleCrouch === 'drop' && CLIMB_POLES_BEFORE.poleTop === 'stop' && CLIMB_TUNE.poleJump === 'plain' && CLIMB_TUNE.poleCrouch === 'drop' && CLIMB_TUNE.poleTop === 'stop';
  resetClimbTune();
  ok(own && CLIMB_TUNE.poleJump === 'fly' && CLIMB_TUNE.poleCrouch === 'slide' && CLIMB_TUNE.poleTop === 'climb', "the round's put back sets maker B's three switches to maker A's let-go and stop ('plain', 'drop', 'stop'); the game ships 'fly', 'slide' and 'climb'");
  tuneClimb({ poleJump: 'plain', poleCrouch: 'drop', poleTop: 'stop' });
  const { b } = await poleWorld(60);
  grabAndClimb(b, 60, 1);
  look(b, 0, -1);
  tapKey(b, 'Space', 60);
  const plain = !b.pole.holding && b.pole.flights === 0;
  b.physics.world.removeRigidBody(b.body);
  const c = await poleWorld(60);
  grabAndClimb(c.b, 60, 1);
  tapKey(c.b, 'KeyX', 60);
  const drop = !c.b.pole.holding && c.b.pole.slides === 0;
  c.b.physics.world.removeRigidBody(c.b.body);
  const s = await standPiece(climbCourse({ pieces: ['pole-top-lip'], poleTops: true }).pieces[0]);
  const t = bodyAt(s, 'stand', 60).b;
  t.key('KeyW', true);
  t.key('KeyE', true);
  run(t, 60, 1);
  t.key('KeyE', false);
  run(t, 60, 6);
  t.key('KeyW', false);
  const stop = t.pole.holding && t.pole.stop === 'top' && t.ledge.climbsFrom === 0;
  t.physics.world.removeRigidBody(t.body);
  resetClimbTune();
  ok(plain && drop && stop, `under the other settings Space lets go straight down (${plain}), the crouch drops (${drop}) and W at the top stops there (${stop}), maker A's`);
}

// ---- other players, the action bar ---------------------------------------------------------------------------------------------------
{
  const { b } = await poleWorld(60);
  grabAndClimb(b, 60, 1);
  const P = b.pole;
  const at = P.peerPlace({ x: 0, y: 0, z: 0 });
  // The free hang's idle's grip, from the place sent, turned by the heading: on the pole's axis at the hands' height.
  const idle = LEDGE_FACTS[LEDGE_ROLES.free.idle];
  const k = P.k;
  const ch = Math.cos(P.heading);
  const sh = Math.sin(P.heading);
  const gx = at.x + (k * idle.g0[0] * ch + k * idle.g0[2] * sh);
  const gz = at.z + (-k * idle.g0[0] * sh + k * idle.g0[2] * ch);
  const gy = at.y + k * (idle.g0[1] - (idle.a0 - LEDGE_REST.ankle));
  const A = P.pole;
  const off = Math.hypot(gx - A.ax, gz - A.az);
  ok(off < 1e-6 && Math.abs(gy - (A.ay + A.uy * P.sDraw)) < 1e-6, `another player's game is told the place a free hang stands with its hands on the pole where the hands are (the grip ${off.toExponential(1)} m off the axis): the nearest pose the wire has, as on a bar`);
  b.physics.world.removeRigidBody(b.body);
  const words = (bar: ReturnType<typeof newPromptState>['bar']) => {
    const s = newPromptState();
    s.live = true;
    s.bar = bar;
    const out = newPromptActions();
    const n = fillActions(s, out);
    return out.slice(0, n).map((a) => `${a.action} ${a.label}`).join(', ');
  };
  ok(words('pole') === `jump ${PROMPT_WORDS.poleJump}, crouch ${PROMPT_WORDS.poleSlide}` && words('poleDrop') === `jump ${PROMPT_WORDS.poleJump}, crouch ${PROMPT_WORDS.barDrop}` && words('poleSlide') === `jump ${PROMPT_WORDS.barLetGo}, crouch ${PROMPT_WORDS.poleSlide}` && words('fly') === '', `the action bar on a pole: "${words('pole')}"; by the switches "${words('poleDrop')}", "${words('poleSlide')}"; nothing in the jump's flight`);
  const P2 = (await poleWorld(60)).b.pole;
  const wordsOf = () => P2.promptWord();
  const w0 = wordsOf();
  tuneClimb({ poleJump: 'plain', poleCrouch: 'drop' });
  ok(w0 === '' && P2.promptWord() === '', 'off the pole it says nothing');
  resetClimbTune();
}

// ---- the game's own lines against the harness's -------------------------------------------------------------------------------------
{
  const player = read('src/player/player.ts');
  const harness = read('tools/swg/tests/grappleBody.ts');
  const main = read('src/main.ts');
  const frame = player.slice(player.indexOf('  private poleFrame('), player.indexOf('  private animatePole('));
  const hFrame = harness.slice(harness.indexOf('  private poleFrame('), harness.indexOf('  /** A grab, as the player'));
  const knock = 'if (this.hp < this.poleHp) P.knock(this.poleHp - this.hp);\n    this.poleHp = this.hp;';
  ok(frame.includes(knock) && hFrame.includes(knock), 'the player and the harness both knock the body off a pole by the health lost since its last frame on it');
  ok(frame.includes('P.catcher = this.poleCatch;') && hFrame.includes('P.catcher = this.poleCatch;') && player.includes('{ bar: () => this.poleCatchBar(), lip: () => this.poleCatchLip(), top: () => this.poleCatchTop() }') && harness.includes('{ bar: () => this.poleCatchBar(), lip: () => this.poleCatchLip(), top: () => this.poleCatchTop() }'), "both hand the pole their bars, ledges and climb up from the top as its catcher");
  ok(/if \(P\.handed === HAND_BAR\) \{\n      this\.takenByBar\(\);\n      this\.barStepsOnce = P\.stepsLeft;\n      this\.barFrame\(dt, input, cam, world\);\n      return;\n    \}\n    this\.takenByLedge\(\);\n    this\.hangFrame\(dt, input, cam, world\);/.test(frame.replace(/\n      this\.takenByLedge/, '\n    this.takenByLedge').replace(/\n      this\.hangFrame/, '\n    this.hangFrame')) || (frame.includes('this.barStepsOnce = P.stepsLeft;\n        this.barFrame(dt, input, cam, world);') && frame.includes('this.takenByLedge();\n      this.hangFrame(dt, input, cam, world);')), "the player hands a bar caught in the flight the frame's steps left and a lip the ledge's frame, at once");
  ok(hFrame.includes('this.barStepsOnce = P.stepsLeft;\n      this.barFrame(dt);') && hFrame.includes('this.takenByLedge();\n      this.hangFrame(dt);'), 'and the harness the same');
  ok(player.includes('B.steps = this.barStepsOnce >= 0 ? this.barStepsOnce : this.physics.stepsAhead(dt);\n    this.barStepsOnce = -1;') && harness.includes('B.steps = this.barStepsOnce >= 0 ? this.barStepsOnce : this.physics.stepsAhead(dt);\n    this.barStepsOnce = -1;'), "the bar's frame takes those steps once, else the frame's own");
  ok(frame.includes('cam.forward(fwd);\n      li.viewYaw = Math.atan2(fwd.x, fwd.z);') && frame.includes('this.jka.holdApex(P.apexY);') && frame.includes('P.swimLine = flat + world.seaSwellOverFlat(this.pos.x, this.pos.z, flat) - SWIM_DEPTH;'), "the player's pole frame hands the pole the view (the jump's way), the water's line and keeps the fall's memory at the flight's top");
  ok(frame.includes('releasePoleClip(this.rig, P);\n      this.placePoleLimbs();\n      this.poleRooted = false;'), "a hand-over lets go of the pole's clip, its hands and feet and its drawn root first");
  ok(player.includes('this.ledge.fromGrip = this.pole.gripY;') && harness.includes('this.ledge.fromGrip = this.pole.gripY;') && player.includes('this.pole.pole.col as unknown as RAPIER.Collider | null);') , "the climb up from the top reaches about the hands on the pole and leaves the pole out (the player's and the harness's)");
  ok(main.includes('if (!s.bar) s.bar = p.pole.promptWord();') && main.includes("if (s.climb !== '' && p.reachPole) s.climbBar = true;") && main.includes(': p.pole.onPole && !p.aboard ? p.pole.peerPlace(leanedAt) : p.worldPos;'), "the game gathers the pole's words for the action bar, says \"grab\" at a pole in reach, and sends a free hang's place on the pole");
  ok(player.includes('if (this.pole.holding) return this.pole.cameraCollider() as unknown as RAPIER.Collider | null;'), "the camera's block asks the pole while it holds the body, the jump's flight included");
}
resetClimbTune();
console.log(`climbPolesOff: ${checks} checks passed`);
