// The hook's line walked at the speed classes' paces. While a class rules the body the game hands the movement no
// walk flag and the class's speed as a share of its run (`c.walk` false, `c.speedScale = loco.speed / (JKA.speed *
// UNIT)`: src/player/player.ts), which is exactly what the hook's node harness takes through its own `speedScale`.
// So the rope is run here against those very numbers: the body walks the line at the class's speed, is stopped at
// the rope's length, and stops when the keys are let go, at 144, 60 and 30 frames a second.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GRAPPLE_DEFAULTS, GRAPPLE_TUNE } from '../../../src/player/grapple.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';
import { LOCO_TUNE_SHIPPED } from '../../../src/anim/locoTune.ts';
import { grappleMutes } from '../../../src/player/grappleMath.ts';
import { TestBody, box, ground, makePhysics } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const r2 = (v: number) => Number(v.toFixed(2));
const RUN = JKA.speed * UNIT;
const T = LOCO_TUNE_SHIPPED;
const CLASSES: [string, number][] = [
  ['walk', T.speed.forward.walk],
  ['jog', T.speed.forward.jog],
  ['run', T.speed.forward.run],
  ['sprint', T.speed.forward.sprint],
];

/** A body on flat ground, hooked to a post behind it by a rope of `length`, walking away at `speed` for `seconds`. */
async function walkOut(fps: number, speed: number, length: number, hooked: boolean) {
  Object.assign(GRAPPLE_TUNE, GRAPPLE_DEFAULTS);
  const physics = await makePhysics();
  ground(physics, 0);
  const post = box(physics, [-0.5, 0, -0.5], [0.5, 2, 0.5], false);
  physics.stepOnce();
  const b = new TestBody(physics);
  b.forward.set(1, 0, 0);
  b.right.set(0, 0, 1);
  b.place(2, 0.02, 0);
  physics.stepOnce();
  b.run(fps, 0.3);
  if (hooked) b.hook(0.5, 1, 0, 1, 0, 0, post, length);
  // What a class ruling the body hands the movement: no walk flag, and its speed as a share of the run.
  b.speedScale = speed / RUN;
  b.key('KeyW', true);
  // The pace on the slack line: over half a second once the body is up to speed.
  b.run(fps, 1.0);
  const x0 = b.pos.x;
  b.run(fps, 0.5);
  const pace = (b.pos.x - x0) / 0.5;
  // On to the rope's end, and a while pressed against it.
  let far = 0;
  let high = 0;
  b.run(fps, Math.max(0, (length + 2) / speed), () => {
    far = Math.max(far, b.pos.x);
    high = Math.max(high, b.pos.y);
  });
  const held = b.pos.x;
  b.run(fps, 1.0, () => {
    far = Math.max(far, b.pos.x);
    high = Math.max(high, b.pos.y);
  });
  const crept = b.pos.x - held;
  // The keys let go: how long the body takes to stand.
  b.key('KeyW', false);
  let stop = -1;
  b.run(fps, 2, (t) => {
    if (stop < 0 && Math.hypot(b.vel.x, b.vel.z) < 0.1) stop = t;
  });
  return { pace, far, crept, high, stop, attached: b.grapple.attached };
}

const ROPE = 14;
for (const fps of [144, 60, 30]) {
  for (const [name, speed] of CLASSES) {
    const free = await walkOut(fps, speed, ROPE, false);
    const roped = await walkOut(fps, speed, ROPE, true);
    ok(Math.abs(free.pace - speed) < 0.03 * speed + 0.02, `${fps} fps, the ${name}: the movement handed the class's share of the run goes ${r2(free.pace)} m/s (the class's ${speed})`);
    ok(Math.abs(roped.pace - free.pace) < 0.01 * speed + 0.01, `${fps} fps, the ${name}: on a slack line the body walks as it walks with no hook out (${r2(roped.pace)} m/s)`);
    // The post's face is at x 0.5 and the rope 14 m: the hand stands a little over the anchor's height, so the body
    // is held a little inside the rope's length from the anchor and never past it.
    ok(roped.attached && roped.far <= 0.5 + ROPE + 0.1 && roped.far > 0.5 + ROPE - 1.2, `${fps} fps, the ${name}: the rope stops it at its length (${r2(roped.far - 0.5)} m out on a ${ROPE} m line) where the body with no hook is ${r2(free.far - 0.5)} m out`);
    ok(Math.abs(roped.crept) < 0.05 && roped.high < 0.1, `${fps} fps, the ${name}: pressed on the line's end it is never lifted (${r2(roped.high * 100)} cm at its highest) and creeps ${r2(Math.abs(roped.crept) * 100)} cm in a second`);
    ok(roped.stop >= 0 && roped.stop <= 0.5 && free.stop >= 0 && free.stop <= 0.5, `${fps} fps, the ${name}: the keys let go, it stands within half a second on the line (${r2(roped.stop)} s) as off it (${r2(free.stop)} s)`);
  }
}

// On the line Shift is the reel, so the classes' own key is held aside while the hook is out: the pace there is the
// jog (the record drops a class each half second with the key not seen), which the game's tab showed (2.84 m/s).
{
  const out: string[] = [];
  grappleMutes(out, true, false);
  ok(out.includes('speedUp'), "with the hook out the classes' key is muted (Shift reels), so on the line the pace comes down to the jog");
  const player = readFileSync(new URL('../../../src/player/player.ts', import.meta.url), 'utf8');
  ok(player.includes('c.walk = classes && !script ? false : walking;') && player.includes('classes && this.loco.moves && !script ? this.loco.speed / (this.loco.posture === CROUCH && this.grounded ? JKA.speed * UNIT * JKA.duckScale : JKA.speed * UNIT) : this.paceScale(walking, mz, mx)'), 'the game hands the movement what this test hands the harness: no walk flag and the class\'s share of the run');
}

console.log(`\n${checks} checks passed`);
