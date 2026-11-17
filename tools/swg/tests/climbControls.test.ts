// Climbing II, phase 2 (items 1 to 5): the controls, through the game's own movement, ledges and wall climb on the real Rapier
// (the course's harness, tools/swg/tests/climbCourseBody.ts, over the grapple's TestBody), frame by frame while moving, at 30,
// 60, 144 and 240 frames a second, each on the course's own pieces (src/anim/climbCourse.ts) or a scene built for the one
// ask the course has no piece for (two lips at two distances, for the nearest):
//  1. the use key grabs and climbs (`climb.grab` 'use'): walking into a wall or jumping at a lip with no E does neither; E
//     held starts the climb as the face comes into reach and grabs a lip a jump reaches; on the ground E grabs a lip in the
//     hands' reach; the press lets go when the key is up; the dispatch gives a falling body's press to the climb first
//     (`climbTakesUseFirst`) and otherwise only one nothing else took (the game's one dispatch line, `promptRules.test.ts`);
//  2. W at a ledge hops up to a lip above where there is one, else climbs onto the top (`climb.wUp`);
//  3. Space with nowhere to hop jumps a little up and off the wall, as high as `offUp` and out at `offPush`
//     (`climb.spaceOff`);
//  4. hops searched in a band (`climb.hops`): sideways across a gap out to `hopSide` from the held lip's end, whatever it is
//     set to; down to a lower lip with S and Space; diagonally; the nearest of two lips taken; the way there arced by `hopArc`;
//  5. stepped lips crossed hand by hand up to `stepMax`, the hands on their lips throughout; past it the end, as before
//     (`climb.steps`);
// and each switch's other word is today's (the course's digest of today with every one at 'before', `climbToday.test.ts`).
import assert from 'node:assert/strict';
import { CLIMB_TUNE, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { climbCourse, lipPiece, type CoursePiece } from '../../../src/anim/climbCourse.ts';
import { climbTakesUseFirst, LEDGE_HANG, LEDGE_MOVE } from '../../../src/player/ledge.ts';
import { bodyAt, hop, jump, nearestLip, runCourse, runUntil, shimmy, standPiece, tap, type Stood } from './climbCourseBody.ts';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const RATES = [30, 60, 144, 240] as const;
const piece = (id: string): CoursePiece => climbCourse({ pieces: [id] }).pieces[0];
const hangs = (b: TestBody) => b.ledge.phase === LEDGE_HANG;
/** The game's own gravity (the ledges' small jump off is worked out against it). */
const G = 800 * 0.0254;

resetClimbTune();
ok(CLIMB_TUNE.grab === 'use' && CLIMB_TUNE.wUp === 'hop' && CLIMB_TUNE.spaceOff === 'jump' && CLIMB_TUNE.hops === 'band' && CLIMB_TUNE.steps === 'hands', 'the new controls ship on (the owner asked for them): grab use, W hops, Space jumps off, hops in a band, steps by hand');

/** A body at a piece's start, grabbed onto its lip by a standing jump with E held after it (null where it was not). */
async function grabbed(id: string | CoursePiece, start: string, fps: number): Promise<{ s: Stood; b: TestBody; w: ReturnType<typeof bodyAt>['w'] } | null> {
  const s = await standPiece(typeof id === 'string' ? piece(id) : id);
  const { b, w } = bodyAt(s, start, fps);
  const j = jump(b, 'stand', fps);
  return j.ok ? { s, b, w } : null;
}
const lipOf = (s: Stood, b: TestBody) => nearestLip(s, b.ledge.lip.ex, b.ledge.lip.ey, b.ledge.lip.ez);

// ---- 1. the use key ------------------------------------------------------------------------------------------------------------
{
  for (const fps of RATES) {
    // A wall 3 m high, the body 1 m from it facing it: W held into it for a second and a half climbs nothing.
    const s = await standPiece(piece('wall-3'));
    const { b } = bodyAt(s, 'stand', fps);
    b.key('KeyW', true);
    runUntil(b, fps, 1.5, () => false);
    const pressed = !b.wall.holding && b.wall.climbs === 0 && b.grounded;
    // E pressed: on the wall within two frames.
    b.key('KeyE', true);
    const t = runUntil(b, fps, 2 / fps + 1e-9, () => b.wall.holding);
    b.key('KeyE', false);
    ok(pressed && Number.isFinite(t), `${fps} fps: W held into a wall for 1.5 s climbs nothing (no E); E pressed starts the climb at once (${n3(t)} s)`);
    // And climbs on up with W, E let go: the press is the start's, the climb its own.
    const tLip = runUntil(b, fps, 6, () => hangs(b));
    b.key('KeyW', false);
    ok(Number.isFinite(tLip), `${fps} fps: ... W climbs it to its lip and the ledges take the body there (${n3(tLip)} s)`);
  }
  for (const fps of RATES) {
    // A standing jump at a 2.6 m braced lip: with no E nothing is grabbed (falling past it as well), and with E held from the
    // frame after the jump the ledges grab it (the wall climb, which waits while the body rises, never takes it).
    const s = await standPiece(lipPiece('lip-2.6', 2.6, true));
    const { b } = bodyAt(s, 'stand', fps);
    b.key('KeyW', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2, () => false);
    b.key('KeyW', false);
    const none = b.ledge.grabs === 0 && b.wall.climbs === 0 && !b.ledge.holding && !b.wall.holding;
    const g = await grabbed(lipPiece('lip-2.6', 2.6, true), 'stand', fps);
    ok(none && !!g && g.b.ledge.grabs === 1 && g.b.wall.climbs === 0 && g.b.ledge.braced, `${fps} fps: a standing jump at a 2.6 m lip with no E grabs nothing and climbs nothing; with E held from the frame after the jump the ledges grab it, braced`);
  }
  for (const fps of RATES) {
    // On the ground under a lip in the hands' reach (2.0 m up), standing still: E grabs it from the ground.
    const s = await standPiece(lipPiece('lip-2.0', 2.0, true));
    const { b } = bodyAt(s, 'stand', fps);
    b.key('KeyE', true);
    const t = runUntil(b, fps, 3, () => hangs(b));
    b.key('KeyE', false);
    ok(Number.isFinite(t) && b.ledge.grabs === 1 && b.ledge.braced && Math.abs(b.ledge.lip.ey - 2.0) < 0.02, `${fps} fps: standing under a 2.0 m lip, E grabs it from the ground and hangs braced (${n3(t)} s)`);
  }
  for (const fps of RATES) {
    // The press holds only while the key does: E tapped on the ground before the jump (let go) grabs nothing in the air.
    const s = await standPiece(lipPiece('lip-2.6', 2.6, true));
    const { b } = bodyAt(s, 'stand', fps);
    tap(b, 'KeyE', fps);
    b.key('KeyW', true);
    tap(b, 'Space', fps);
    runUntil(b, fps, 2, () => false);
    b.key('KeyW', false);
    ok(b.ledge.grabs === 0 && !b.climbAsk.on, `${fps} fps: E tapped before the jump and let go grabs nothing (the press lets go with the key)`);
  }
  for (const fps of RATES) {
    // Falling past a lip, W held toward it: no E, passed; E held, grabbed.
    const fall = async (e: boolean): Promise<TestBody> => {
      const s = await standPiece(lipPiece('lip-2.6', 2.6, true));
      const { b } = bodyAt(s, 'stand', fps);
      b.place(b.pos.x, 2.4, b.pos.z + 0.1);
      b.key('KeyW', true);
      if (e) b.key('KeyE', true);
      runUntil(b, fps, 2, () => hangs(b));
      b.key('KeyW', false);
      b.key('KeyE', false);
      return b;
    };
    const no = await fall(false);
    const yes = await fall(true);
    ok(no.ledge.grabs === 0 && yes.ledge.grabs === 1 && hangs(yes), `${fps} fps: falling past a 2.6 m lip moving at it, no E passes it and E held grabs it`);
  }
  // The dispatch's rule: falling on foot the climb has the key first; standing, rising or carried, never.
  ok(climbTakesUseFirst('use', true, false, -1) && !climbTakesUseFirst('use', true, true, 0) && !climbTakesUseFirst('use', true, false, 2) && !climbTakesUseFirst('use', false, false, -1) && !climbTakesUseFirst('auto', true, false, -1), "the use key goes to the climb first only on foot and falling, under 'use' (standing, rising, riding, or under 'auto': the dispatch's own chain first)");
  // Today's: under 'auto' W held into the wall climbs it (after `wallStart`), with no E.
  tuneClimb({ grab: 'auto' });
  for (const fps of RATES) {
    const s = await standPiece(piece('wall-3'));
    const { b } = bodyAt(s, 'stand', fps);
    b.key('KeyW', true);
    const t = runUntil(b, fps, 2, () => b.wall.holding);
    b.key('KeyW', false);
    ok(Number.isFinite(t) && t >= CLIMB_TUNE.wallStart, `${fps} fps: under grab 'auto' W held into the wall climbs it with no E, after pressing in for wallStart (${n3(t)} s)`);
  }
  resetClimbTune();
}

// ---- 2. W at a ledge -----------------------------------------------------------------------------------------------------------
for (const fps of RATES) {
  // Under a lip above (the course's lips up and down, 1.0 m apart): W pressed hops up to it.
  const g = await grabbed('gap-updown-1.0', 'onA', fps);
  assert.ok(g, `a grab of A at ${fps}`);
  shimmy(g.s, g.b, g.w, 'KeyD', fps, 20, 4);
  tap(g.b, 'KeyW', fps);
  const t = runUntil(g.b, fps, 3, () => hangs(g.b) && lipOf(g.s, g.b).name === 'B');
  ok(Number.isFinite(t) && Math.abs(g.b.ledge.lip.ey - 3.6) < 0.02, `${fps} fps: W pressed under a lip 1.0 m above hops up to it (${n3(t)} s, hanging from ${n3(g.b.ledge.lip.ey)} m)`);
  // On a lone lip with nothing above it: W climbs onto the top, as before.
  const h = await grabbed(lipPiece('lip-2.4', 2.4, true), 'stand', fps);
  assert.ok(h, `a grab of a lone lip at ${fps}`);
  tap(h.b, 'KeyW', fps);
  runUntil(h.b, fps, 3, () => !h.b.ledge.holding);
  h.b.run(fps, 0.2);
  ok(h.b.grounded && !h.b.ledge.holding && Math.abs(h.b.pos.y - 2.4) < 0.02, `${fps} fps: W pressed at a lip with nothing above climbs onto its top (feet at ${n3(h.b.pos.y)} m)`);
}

// ---- 3. Space with nowhere to hop ------------------------------------------------------------------------------------------------
for (const [up, push] of [[CLIMB_TUNE.offUp, CLIMB_TUNE.offPush], [0.8, 3]] as const) {
  tuneClimb({ offUp: up, offPush: push });
  for (const fps of RATES) {
    for (const key of ['', 'KeyD', 'KeyW'] as const) {
      const g = await grabbed(lipPiece('lip-2.4', 2.4, true), 'stand', fps);
      assert.ok(g);
      const b = g.b;
      const y0 = b.pos.y;
      const nx = b.ledge.lip.nx;
      const nz = b.ledge.lip.nz;
      if (key) b.key(key, true);
      tap(b, 'Space', fps);
      if (key) b.key(key, false);
      const vy = b.vel.y;
      const out = b.vel.x * nx + b.vel.z * nz;
      let top = b.pos.y;
      runUntil(b, fps, 2, () => {
        top = Math.max(top, b.pos.y);
        return b.grounded;
      });
      // How high it rises is the movement's own flight: velocity first, then the place, so a frame of `dt` falls short of
      // v^2/2g by v dt / 2 (the same on every jump from the ground: the jump's height by frame rate, the movement's, not this).
      const rise = up - (vy / fps) * 0.5;
      ok(b.ledge.lastLetGo === 'jumped off a little' && Math.abs(vy - Math.sqrt(2 * G * up)) < 1e-9 && Math.abs(out - push) < 1e-9 && Math.abs(top - y0 - rise) < 0.01 && b.grounded, `${fps} fps, Space${key ? ` with ${key.slice(3)}` : ''} at a lone lip: a small jump off the wall, up at ${n3(vy)} m/s (offUp ${up}) and out at ${n3(out)} m/s (offPush ${push}), rising ${n3(top - y0)} m (the movement's own flight at ${fps} fps: ${n3(rise)}), and down on the ground`);
    }
  }
  resetClimbTune();
}
{
  // Today's (spaceOff 'before'): Space alone climbs up.
  tuneClimb({ spaceOff: 'before', wUp: 'before' });
  const g = await grabbed(lipPiece('lip-2.4', 2.4, true), 'stand', 60);
  assert.ok(g);
  tap(g.b, 'Space', 60);
  runUntil(g.b, 60, 3, () => !g.b.ledge.holding);
  g.b.run(60, 0.2);
  ok(g.b.grounded && Math.abs(g.b.pos.y - 2.4) < 0.02, "under spaceOff 'before' Space alone climbs onto the top, as it did");
  resetClimbTune();
}

// ---- 4. hops in a band --------------------------------------------------------------------------------------------------------
{
  /** From A's end (D to it), D with Space: whether B is reached, and the hop's highest place over its straight line. */
  const sideHop = async (id: string, fps: number): Promise<{ reached: boolean; arc: number; len: number; words: string }> => {
    const g = await grabbed(id, 'onA', fps);
    assert.ok(g, `a grab of ${id} at ${fps}`);
    shimmy(g.s, g.b, g.w, 'KeyD', fps);
    const b = g.b;
    const fx = b.pos.x;
    const fy = b.pos.y;
    const fz = b.pos.z;
    let arc = 0;
    let moved = false;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    const path: [number, number, number][] = [];
    b.key('KeyD', true);
    tap(b, 'Space', fps);
    b.key('KeyD', false);
    runUntil(b, fps, 3, () => {
      if (b.ledge.phase === LEDGE_MOVE) {
        moved = true;
        path.push([b.pos.x, b.pos.y, b.pos.z]);
      }
      return moved && hangs(b);
    });
    if (moved) {
      tx = b.pos.x;
      ty = b.pos.y;
      tz = b.pos.z;
      for (const [x, y, z] of path) {
        const dx = tx - fx;
        const dz = tz - fz;
        const k = Math.max(0, Math.min(1, ((x - fx) * dx + (z - fz) * dz) / (dx * dx + dz * dz)));
        arc = Math.max(arc, y - (fy + (ty - fy) * k));
      }
    }
    const reached = hangs(b) && lipOf(g.s, b).name === 'B';
    return { reached, arc, len: Math.hypot(tx - fx, ty - fy, tz - fz), words: b.ledgeWords.join(' ') };
  };
  for (const fps of RATES) {
    const h = await sideHop('gap-side-1.5', fps);
    ok(h.reached && Math.abs(h.arc - CLIMB_TUNE.hopArc * h.len) < 0.03, `${fps} fps: a gap of 1.5 m (hopSide ${CLIMB_TUNE.hopSide}) is hopped across, the way rising ${n3(h.arc)} m at its middle over ${n3(h.len)} m (hopArc ${CLIMB_TUNE.hopArc}: ${n3(CLIMB_TUNE.hopArc * h.len)})`);
  }
  for (const [reach, id] of [[3, 'gap-side-3.0'], [6, 'gap-side-6.0']] as const) {
    tuneClimb({ hopSide: reach });
    for (const fps of RATES) {
      const h = await sideHop(id, fps);
      ok(h.reached, `${fps} fps: with hopSide ${reach} a gap of ${reach} m is hopped across (the search reaches what the slider is set to)`);
    }
    resetClimbTune();
  }
  {
    const h = await sideHop('gap-side-3.0', 60);
    ok(!h.reached, `60 fps: with hopSide ${CLIMB_TUNE.hopSide} a gap of 3 m is not (nowhere to hop: the small jump off)`);
  }
  // Today's (hops 'before'): a gap of 1.5 m is refused.
  tuneClimb({ hops: 'before', spaceOff: 'before' });
  {
    const h = await sideHop('gap-side-1.5', 60);
    ok(!h.reached && /No ledge to hop to\./.test(h.words), "under hops 'before' the same 1.5 m gap is refused in words, as it was");
  }
  resetClimbTune();
  for (const fps of RATES) {
    for (const span of ['1.0', '1.5']) {
      // Up with W and Space to B, then down with S and Space back to A.
      const g = await grabbed(`gap-updown-${span}`, 'onA', fps);
      assert.ok(g);
      shimmy(g.s, g.b, g.w, 'KeyD', fps, 20, 4);
      const upH = hop(g.s, g.b, 'KeyW', fps, 'B');
      const downH = hop(g.s, g.b, 'KeyS', fps, 'A');
      ok(upH.reached && downH.reached, `${fps} fps: up ${span} m with W and Space to the lip above, and down again with S and Space to the lip below`);
    }
    // Diagonally: up and right to B, then from B down and left to A.
    const d = await grabbed('gap-diag-1.5', 'onA', fps);
    assert.ok(d);
    shimmy(d.s, d.b, d.w, 'KeyD', fps);
    const diagUp = hop(d.s, d.b, 'KeyD', fps, 'B');
    shimmy(d.s, d.b, d.w, 'KeyA', fps);
    const diagDown = hop(d.s, d.b, 'KeyA', fps, 'A');
    ok(diagUp.reached && diagDown.reached, `${fps} fps: diagonally 1.5 m, up and across to the higher lip and back down and across to the lower`);
  }
  // The nearest of two: a lip 1 m across the gap and another 1 m past it, hopSide 6 reaching both; and two lips above at
  // 0.8 and 1.4 m (each set back), hopUp reaching both: the nearer is taken each way.
  for (const fps of RATES) {
    const p = await makePhysics();
    ground(p, 0);
    box(p, [1, 0, 2], [6, 2.6, 3]);
    box(p, [-1.5, 0, 2], [0, 2.6, 3]);
    box(p, [-6, 0, 2], [-2.5, 2.6, 3]);
    p.stepOnce();
    tuneClimb({ hopSide: 6 });
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(4, 0, 1.2);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.run(fps, 0.3);
    jump(b, 'stand', fps);
    assert.ok(hangs(b));
    // D along A to its end (let go there: a shimmy goes on round a block's corner).
    b.key('KeyD', true);
    runUntil(b, fps, 20, () => b.pos.x < 1.5);
    b.key('KeyD', false);
    b.run(fps, 0.2);
    b.key('KeyD', true);
    tap(b, 'Space', fps);
    b.key('KeyD', false);
    let left = false;
    runUntil(b, fps, 3, () => {
      if (!hangs(b)) left = true;
      return left && hangs(b);
    });
    ok(hangs(b) && b.pos.x < 0 && b.pos.x > -1.5, `${fps} fps: two lips across the gap at 1 m and 3.5 m: the hop takes the nearer (hanging at x ${n3(b.pos.x)})`);
    resetClimbTune();
  }
  for (const fps of RATES) {
    const p = await makePhysics();
    ground(p, 0);
    box(p, [-3, 0, 2], [3, 2.6, 2.3]);
    box(p, [-1, 0, 2.3], [1, 3.4, 2.6]);
    box(p, [-1, 0, 2.6], [1, 4.0, 4]);
    p.stepOnce();
    const b = new TestBody(p);
    b.jka.forceLevel = 0;
    b.place(2.4, 0, 1.2);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    b.run(fps, 0.3);
    jump(b, 'stand', fps);
    assert.ok(hangs(b));
    b.key('KeyD', true);
    runUntil(b, fps, 20, () => b.pos.x < 0.05);
    b.key('KeyD', false);
    b.run(fps, 0.2);
    tap(b, 'KeyW', fps);
    runUntil(b, fps, 3, () => hangs(b) && b.ledge.lip.ey > 3);
    const first = b.ledge.lip.ey;
    tap(b, 'KeyW', fps);
    runUntil(b, fps, 3, () => hangs(b) && b.ledge.lip.ey > 3.8);
    ok(Math.abs(first - 3.4) < 0.02 && Math.abs(b.ledge.lip.ey - 4.0) < 0.02, `${fps} fps: two lips above at 0.8 and 1.4 m, each set back: W hops to the nearer (${n3(first)} m), and W again on to the next (${n3(b.ledge.lip.ey)} m)`);
  }
  // A lip above set to one side: 0.8 m up and starting 0.4 m along from the hands. Within `hopSlack` (0.75) either side, W
  // finds it; with the slack narrowed past it (0.2) it is not there to hop to.
  for (const fps of RATES) {
    const reachWith = async (slack: number | null) => {
      const p = await makePhysics();
      ground(p, 0);
      box(p, [-3, 0, 2], [3, 2.6, 2.3]);
      box(p, [0.4, 0, 2.3], [1.4, 3.4, 2.6]);
      p.stepOnce();
      resetClimbTune();
      if (slack !== null) tuneClimb({ hopSlack: slack });
      const b = new TestBody(p);
      b.jka.forceLevel = 0;
      b.place(-2.2, 0, 1.2);
      b.forward.set(0, 0, 1);
      b.right.set(-1, 0, 0);
      b.run(fps, 0.3);
      jump(b, 'stand', fps);
      assert.ok(hangs(b));
      b.key('KeyA', true);
      runUntil(b, fps, 20, () => b.pos.x > -0.05);
      b.key('KeyA', false);
      b.run(fps, 0.2);
      tap(b, 'KeyW', fps);
      runUntil(b, fps, 3, () => hangs(b) && b.ledge.lip.ey > 3);
      const out = { ey: b.ledge.lip.ey, x: b.pos.x, hanging: hangs(b) };
      resetClimbTune();
      return out;
    };
    const wide = await reachWith(null);
    const narrow = await reachWith(0.2);
    ok(wide.hanging && Math.abs(wide.ey - 3.4) < 0.02 && wide.x > 0.3 && wide.x < 1.5 && !(narrow.hanging && narrow.ey > 3), `${fps} fps: a lip 0.8 m above set 0.4 m to one side: W hops to it within hopSlack ${CLIMB_TUNE.hopSlack} (hanging at x ${n3(wide.x)}, lip ${n3(wide.ey)} m), and not with the slack at 0.2 (lip ${n3(narrow.ey)} m)`);
  }
}

// ---- 5. stepped lips -----------------------------------------------------------------------------------------------------------
{
  const { runs } = await runCourse(['steps-0.2', 'steps-0.35', 'steps-0.5', 'steps-0.6']);
  for (const r of runs) {
    const step = Number(r.id.split('-')[1]);
    const [d, a] = r.shimmies;
    if (step <= CLIMB_TUNE.stepMax + 1e-9) {
      ok(d.why === 'end' && d.on === 'S4' && Math.abs(d.rose - 2 * step) < 0.01 && a.why === 'end' && a.on === 'S0' && Math.abs(a.rose + 4 * step) < 0.01 && r.handOff <= 0.02 && r.falls === 0, `${r.fps} fps: steps of ${step} m (stepMax ${CLIMB_TUNE.stepMax}) are crossed hand by hand, up to the far end (rose ${d.rose}) and down to the other (${a.rose}), every hand within ${n3(r.handOff)} m of its lip`);
    } else ok(d.why === 'stopped' && d.on === 'S2', `${r.fps} fps: a step of ${step} m (past stepMax ${CLIMB_TUNE.stepMax}) is the lip's end, as before (stopped ${d.moved} m along)`);
  }
}

console.log(`climbControls: ${checks} checks passed`);
