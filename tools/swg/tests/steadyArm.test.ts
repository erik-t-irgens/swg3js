// Steady Arm's "+25% throw range", pinned as the range and never as a factor.
//
// A throw leaves the hand lobbed up a little at the grenade's speed with a fixed lift added on top
// (`src/combat/demoMath.ts`, the very lines the Bounty Hunter's throw runs), so scaling the speed alone takes a
// level throw only about 18% further. Steady Arm scales the speed and the lift together, by a factor of ours
// solved for the doc's number; what is held here is the number, through the real resolver and the player's own
// kept grenade, so the factor may be tuned and the test still says whether the throw lands a quarter further.
//
// The reference throw is a fragmentation grenade thrown level from the hand height the throw falls back on,
// standing still, flown under the world's 20 m/s^2 in small steps to its first touch of a flat floor at the
// ball's own radius.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { THROW_BALL, THROW_SHAPE, lobbed, throwVelocity } from '../../../src/combat/demoMath.ts';
import { GADGETS } from '../../../src/combat/gadgets.ts';
import { PlayerStats } from '../../../src/player/playerStats.ts';
import { grantChanges } from '../../../src/progress/learn.ts';
import { applyProgress, emptyRecord } from '../../../src/progress/record.ts';
import { PROGRESS_RULES } from '../../../src/progress/tune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The world's gravity (`src/core/physics.ts`'s world, y -20). */
const GRAVITY = 20;

/** How far along the ground from the thrower's feet a throw first touches a flat floor. */
function range(speed: number, upward: number): number {
  const dir = lobbed(new THREE.Vector3(1, 0, 0));
  const from = new THREE.Vector3(0, THROW_SHAPE.hand, 0).addScaledVector(dir, THROW_SHAPE.ahead);
  const v = throwVelocity(dir, speed, upward, 0, 0, { x: 0, y: 0, z: 0 });
  const dt = 1 / 2000;
  let x = from.x;
  let y = from.y;
  let vy = v.y;
  for (let i = 0; i < 200000; i++) {
    x += v.x * dt;
    vy -= GRAVITY * dt;
    y += vy * dt;
    if (y <= THROW_BALL) return x;
  }
  return NaN;
}

const frag = GADGETS.find((g) => g.id === 'frag')!.grenade!;
const plain = new PlayerStats();
const plainSpec = plain.grenade(frag);
ok(plainSpec === frag && plain.throwLift === 4, "without the node the frag is the gadget's own spec and the lift today's 4 m/s");
const before = range(plainSpec.speed, plain.throwLift);

const rec = emptyRecord('arm');
const g = grantChanges(rec, 'demo.grenadier.1', 1000, PROGRESS_RULES);
ok(!g.why && applyProgress(rec, g.ch).changed === 2, 'Steady Arm is granted with the Novice it needs');
const armed = new PlayerStats();
ok(armed.update(rec), 'and moves the stats');
const spec = armed.grenade(frag);
ok(spec !== frag && spec.speed > frag.speed && armed.throwLift > 4 && frag.speed === 18, `the frag leaves faster (${spec.speed.toFixed(3)} m/s, the gadget's own still ${frag.speed}) and lifted harder (${armed.throwLift.toFixed(3)} m/s)`);
const after = range(spec.speed, armed.throwLift);
const ratio = after / before;
ok(Math.abs(ratio - 1.25) <= 0.0125, `a level throw lands a quarter further: ${before.toFixed(2)} m to ${after.toFixed(2)} m, ${ratio.toFixed(4)} times (the doc's 1.25, within 1%)`);
// And why both are scaled: the speed alone falls well short.
const speedAlone = range(frag.speed * Math.sqrt(1.25), 4) / before;
ok(speedAlone < 1.21, `scaling the speed alone by the square root of 1.25 would only reach ${speedAlone.toFixed(3)} times`);

console.log(`\n${checks} checks passed`);
