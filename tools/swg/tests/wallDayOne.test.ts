// Wave 4 of the animations, item B, day one: with `climb.wall` at 'before' (and the ledges' at theirs), the body is
// e2b9776's own to the bit, that commit's grapple harness and grapple read out of git (a recorded digest where git cannot
// answer):
//  - the harness's body over scenes made for the wall climb -- W held into an upright wall 5 m high (and then S and A held
//    against it), into a 70-degree face, along a wall at a glance, a jump into a wall with W held, and W held into a wall
//    lower than the hands -- at 30, 60 and 144 frames a second, every place, velocity and verdict by `Object.is`;
//  - and under 'on' the same scenes do change (the climb takes the body), so the check above is not blind.
// The hands' bracing moves no body at all (it turns the drawn arms after the figure is placed): its day one is in
// braceRule.test.ts (under 'before' nothing is felt for and nothing placed).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Today from './grappleBody.ts';
import { CLIMB_TUNE, resetClimbTune, climbTwoBefore } from '../../../src/anim/climbTune.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { loadOldMany } from './oldModules.ts';
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
const note = (what: string) => console.log(`note ${what}`);

const PRE_WAVE = 'e2b9776';
/** The digest of the day-one trace under e2b9776's own modules (what a checkout with no history is held to). */
const BODY_TRACE = 'c4dd0cf87326a070';

type Harness = typeof Today;
type Body = InstanceType<Harness['TestBody']>;

async function trace(H: Harness): Promise<string[]> {
  const rows: string[] = [];
  const n = (v: number) => (Object.is(v, -0) ? '-0' : String(v));
  const row = (b: Body, tag: string) => rows.push([tag, n(b.pos.x), n(b.pos.y), n(b.pos.z), n(b.vel.x), n(b.vel.y), n(b.vel.z), String(b.grounded), n(b.hp)].join(' '));
  const scene = async (build: (p: Today.Physics) => void) => {
    const p = await H.makePhysics();
    H.ground(p, 0);
    build(p);
    p.stepOnce();
    return p;
  };
  const body = (p: Today.Physics, x: number, y: number, z: number) => {
    const b = new H.TestBody(p) as Body;
    b.jka.forceLevel = 0;
    b.place(x, y, z);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    return b;
  };
  for (const fps of [30, 60, 144]) {
    const dt = 1 / fps;
    const run = (b: Body, tag: string, seconds: number, each?: (i: number) => void) => {
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        each?.(i);
        b.frame(dt);
        row(b, tag);
      }
    };
    const hold = (b: Body, key: string, tag: string, seconds: number) => {
      b.key(key, true);
      run(b, tag, seconds);
      b.key(key, false);
    };
    // Into an upright wall 5 m high with W held, then S and A held against it.
    {
      const p = await scene((q) => H.box(q, [-4, 0, 2], [4, 5, 3]));
      const b = body(p, 0, 0, 1);
      run(b, `${fps} upright`, 0.3);
      hold(b, 'KeyW', `${fps} upright`, 3);
      hold(b, 'KeyS', `${fps} upright`, 1);
      hold(b, 'KeyA', `${fps} upright`, 0.5);
    }
    // Into a 70-degree face.
    {
      const p = await scene((q) => wedge(q, 70, 4));
      const b = body(p, 0, 0, 1);
      run(b, `${fps} seventy`, 0.3);
      hold(b, 'KeyW', `${fps} seventy`, 3);
    }
    // Along a wall at a glance.
    {
      const p = await scene((q) => H.box(q, [-4, 0, 2], [4, 5, 3]));
      const b = body(p, -3, 0, 1.62);
      b.forward.set(1, 0, 0.15).normalize();
      b.right.set(0, 0, -1);
      run(b, `${fps} glance`, 0.3);
      hold(b, 'KeyW', `${fps} glance`, 1.5);
    }
    // A jump into a wall with W held.
    {
      const p = await scene((q) => H.box(q, [-4, 0, 2], [4, 5, 3]));
      const b = body(p, 0, 0, 0.5);
      run(b, `${fps} jump`, 0.3);
      b.key('KeyW', true);
      b.key('Space', true);
      run(b, `${fps} jump`, 2.5, (i) => i === 1 && b.key('Space', false));
      b.key('KeyW', false);
    }
    // A wall lower than the hands.
    {
      const p = await scene((q) => H.box(q, [-4, 0, 2], [4, 1.4, 3]));
      const b = body(p, 0, 0, 1);
      run(b, `${fps} low`, 0.3);
      hold(b, 'KeyW', `${fps} low`, 1.5);
    }
  }
  return rows;
}

{
  CLIMB_TUNE.ledges = 'before';
  CLIMB_TUNE.wall = 'before';
  // Stairs II's step-up mend is a switch of its own (its day one in playerStepUp.test.ts): 'before' for both traces here, which hold
  // the wall's switch alone (at 144 frames a second the mend puts the collider where the body is before every move).
  LOCO_TUNE.step.rule = 'before';
  const before = await trace(Today);
  resetClimbTune();
  climbTwoBefore();
  CLIMB_TUNE.ledges = 'before';
  const on = await trace(Today);
  resetClimbTune();
  climbTwoBefore();
  LOCO_TUNE.step.rule = 'mended';
  const digest = createHash('sha1').update(before.join('\n')).digest('hex').slice(0, 16);
  const first = on.findIndex((r, i) => r !== before[i]);
  ok(first >= 0 && on.length === before.length, `under climb.wall 'on' the same scenes change (from row ${first}: ${on[first]?.split(' ').slice(0, 2).join(' ')}), so the check is not blind`);
  const old = await loadOldMany(['tools/swg/tests/grappleBody.ts', 'src/player/grapple.ts'], ['tools/swg/tests/grappleBody.ts'], PRE_WAVE);
  if (old) {
    const then = await trace(old[0] as unknown as Harness);
    const at = before.findIndex((r, i) => r !== then[i]);
    ok(before.length === then.length && at < 0, `day one: under climb.wall 'before' the body is ${PRE_WAVE}'s own over the wall's scenes, frame for frame at 30, 60 and 144 frames a second (${before.length} rows, every number by Object.is)${at >= 0 ? `: row ${at} is ${before[at]} against ${then[at]}` : ''}`);
    note(`the body's trace digest is ${digest} (BODY_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s harness here: the body's trace is held to the digest recorded from it`);
  ok(digest === BODY_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own modules (${digest})`);
}
console.log(`wallDayOne: ${checks} checks passed`);
