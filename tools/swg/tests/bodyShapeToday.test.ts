// Climbing II's feedback round, items 3 and 4, held to `12ae8ad` where no trace held them before (the brief: "where a posture
// or a walk under a roof has no trace pinned today, record one at 12ae8ad first, a hash written into the test from a run of
// that commit's code out of git, asserted with git and without"). The grapple's harness (`TestBody`: Jedi Academy's movement,
// the controller, the slope rule and the step in the player's order on the real Rapier) at 30, 60, 144 and 240 frames a
// second, every frame's place, velocity, ground and capsule into one digest, over the movement the round's two body switches
// reach: the crouch key down and up standing, walking crouched and let go, walking up stairs crouching on the way, walking and
// running at a beam a standing body cannot pass under, crouch-walking at one a crouch cannot, and a crouched jump under a slab.
//  - Today's harness with every switch of the round at its other setting (`climbFeedbackBefore`, which sets `moveBefore`
//    too) gives the digest recorded here from `12ae8ad`'s own harness and climbing out of git, always;
//  - and where git can hand `12ae8ad`'s files over, that commit's harness is run again and gives it too (`SWG3JS_NO_OLD=1`
//    runs the path without it on purpose).
// Prone and kneeling are the player's alone (the harness had no posture keys at `12ae8ad`): their 'before' path is the
// player's own line, held as text to `12ae8ad`'s.
//
// Run: node tools/swg/tests/bodyShapeToday.test.ts
import assert from 'node:assert/strict';
import { createHash, type Hash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as Today from './grappleBody.ts';
import { loadOld, oldTexts } from './oldModules.ts';
import { climbFeedbackBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { resetMoveTune } from '../../../src/anim/moveTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

/** The commit, the digest of its own harness over the scenes below, and how many frames that was. */
const BASE = '12ae8ad';
const RECORDED = { digest: '996f0a7ac182669631d7b363e54c81c00b140772108b7b7fae6c64fca73c7768', frames: 7777 };

type Harness = Pick<typeof Today, 'TestBody' | 'box' | 'ground' | 'makePhysics'>;
type Body = InstanceType<typeof Today.TestBody>;
const RATES = [30, 60, 144, 240] as const;

/** One frame of a body into the hash: its place, velocity, ground word and capsule (its middle and its straight half). */
function frameInto(h: Hash, b: Body): void {
  const v = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.grounded ? 1 : 0, b.colliderOffsetY, b.collider.halfHeight()];
  h.update(new Float64Array(v));
}

/** The scenes, run through the harness handed in, every frame hashed. */
async function scenes(H: Harness): Promise<{ digest: string; frames: number; ends: string[] }> {
  const h = createHash('sha256');
  let frames = 0;
  const ends: string[] = [];
  const stand = async (build: (p: Today.Physics) => void): Promise<Body> => {
    const p = await H.makePhysics();
    build(p);
    p.stepOnce();
    const b = new H.TestBody(p) as Body;
    b.place(0, 0, 0);
    b.forward.set(0, 0, 1);
    b.right.set(-1, 0, 0);
    return b;
  };
  const go = (b: Body, fps: number, seconds: number) =>
    b.run(fps, seconds, () => {
      frameInto(h, b);
      frames++;
    });
  const end = (what: string, fps: number, b: Body) => ends.push(`${what} ${fps}: ${b.pos.x.toFixed(4)},${b.pos.y.toFixed(4)},${b.pos.z.toFixed(4)} mid ${b.colliderOffsetY.toFixed(3)}`);
  for (const fps of RATES) {
    // The crouch key down and up standing, then walking crouched and letting go of it under the open sky.
    {
      const b = await stand((p) => H.ground(p, 0));
      go(b, fps, 0.3);
      b.key('ControlLeft', true);
      go(b, fps, 0.5);
      b.key('ControlLeft', false);
      go(b, fps, 0.5);
      b.key('ControlLeft', true);
      b.key('KeyW', true);
      go(b, fps, 1);
      b.key('ControlLeft', false);
      go(b, fps, 1);
      b.key('KeyW', false);
      end('crouch toggles', fps, b);
    }
    // Up stairs of 0.17 m risers, crouching on the way and standing again.
    {
      const b = await stand((p) => {
        H.ground(p, 0);
        for (let i = 0; i < 12; i++) H.box(p, [-2, 0, 2 + i * 0.3], [2, 0.17 * (i + 1), 2 + (i + 1) * 0.3], false);
      });
      b.key('KeyW', true);
      go(b, fps, 1.2);
      b.key('ControlLeft', true);
      go(b, fps, 1);
      b.key('ControlLeft', false);
      go(b, fps, 1.2);
      b.key('KeyW', false);
      end('stairs', fps, b);
    }
    // Walking and running at a beam 1.3 m up a standing body cannot pass under, and crouch-walking at one 0.9 m up.
    for (const [what, under, crouch, walk] of [['walk at a beam', 1.3, false, true], ['run at a beam', 1.3, false, false], ['crouch at a beam', 0.9, true, true]] as const) {
      const b = await stand((p) => {
        H.ground(p, 0);
        H.box(p, [-3, under, 3], [3, under + 0.3, 3.4], false);
      });
      if (crouch) b.key('ControlLeft', true);
      if (walk) b.key('ShiftLeft', true);
      b.key('KeyW', true);
      go(b, fps, 2.5);
      b.key('KeyW', false);
      b.key('ShiftLeft', false);
      b.key('ControlLeft', false);
      go(b, fps, 0.3);
      end(what, fps, b);
    }
    // A crouched jump under a slab 1.1 m up: the crouch held, the jump into the slab.
    {
      const b = await stand((p) => {
        H.ground(p, 0);
        H.box(p, [-3, 1.1, -3], [3, 1.4, 3], false);
      });
      b.key('ControlLeft', true);
      go(b, fps, 0.3);
      b.key('Space', true);
      go(b, fps, 1 / fps);
      b.key('Space', false);
      go(b, fps, 1);
      b.key('ControlLeft', false);
      end('crouched jump', fps, b);
    }
  }
  return { digest: h.digest('hex'), frames, ends };
}

// ---- 1. today's harness, every switch of the round at its other setting ------------------------------------------------------
resetMoveTune();
resetClimbTune();
climbFeedbackBefore();
const today = await scenes(Today);
resetMoveTune();
resetClimbTune();
if (today.digest !== RECORDED.digest) for (const e of today.ends) console.log(`end  ${e}`);
console.log(`now  digest ${today.digest} over ${today.frames} frames`);
ok(today.digest === RECORDED.digest && today.frames === RECORDED.frames, `with every switch of the round at its other setting, today's crouching, stairs, beams and a crouched jump are ${BASE}'s to the bit (${today.frames} frames, digest ${today.digest.slice(0, 16)}, recorded from ${BASE}'s own harness)`);

// ---- 2. that commit's own harness, where git can hand it over --------------------------------------------------------------
{
  const files = ['tools/swg/tests/grappleBody.ts', 'src/player/ledge.ts', 'src/anim/climbTune.ts', 'src/anim/ledgeClips.ts'];
  const Old = await loadOld<Harness & { resetClimbTune?: () => void }>(files, 'tools/swg/tests/grappleBody.ts', BASE);
  if (!Old) note(`git cannot hand ${BASE}'s files over here: held to the recorded digest alone`);
  else {
    const old = await scenes(Old);
    console.log(`old  digest ${old.digest} over ${old.frames} frames`);
    ok(old.digest === RECORDED.digest && old.frames === RECORDED.frames, `${BASE}'s own harness and climbing, out of git, give the recorded digest (${old.digest.slice(0, 16)})`);
  }
}

// ---- 3. prone and kneeling, the player's alone: its 'before' path held to 12ae8ad's text -----------------------------------
{
  const now = readFileSync(new URL('../../../src/player/player.ts', import.meta.url), 'utf8').replace(/\r/g, '');
  const then = oldTexts(['src/player/player.ts'], BASE)?.get('src/player/player.ts') ?? null;
  const today = (what: string) => now.includes(what);
  const was = 'this.setCrouchCollider((this.crouching || this.prone || this.kneeling) && this.grounded);';
  ok(today(`if (shapeRulesOn()) this.stepShape(dt, moving, move);\n    else ${was}`), "with both body switches at their other setting the player's posture block writes the capsule by today's line, as it stood");
  ok(today("this.prone = lyingRule ? this.proneAsk(!this.prone, input) : !this.prone;") && today('if (this.kneeling) this.prone = lyingRule ? this.proneAsk(false, input) : false;'), "and its prone and kneel toggles are the old toggles wherever 'lying' is not chosen");
  // The crouch collider's own body, less the two lines the round put at its top (which do nothing while no shape is lying:
  // `followCrouch` writes only the shape's own record), is the old method's to the character.
  const method = (src: string) => {
    const at = src.indexOf('  private setCrouchCollider(crouched: boolean): void {');
    return at < 0 ? '' : src.slice(at, src.indexOf('\n  }\n', at) + 4);
  };
  const mNow = method(now)
    .replace('    // The body\'s shape left it lying (item 3): upright again before today\'s rule writes it.\n    if (this.shape.kind === LYING) this.shape.writeUpright(this.collider, this.pos.x, this.pos.y, this.pos.z, STAND_TALL);\n    this.shape.followCrouch(crouched);\n', '');
  if (then === null) note(`git cannot hand ${BASE}'s player over here: its crouch collider held by the line above alone`);
  else {
    ok(mNow.length > 0 && mNow === method(then.replace(/\r/g, '')), `the crouch collider's method less the round's two lines at its top is ${BASE}'s to the character`);
    ok(then.replace(/\r/g, '').includes(`    ${was}`), `and ${BASE}'s posture block wrote the capsule by that very line`);
  }
}

console.log(`bodyShapeToday: ${checks} checks passed`);
