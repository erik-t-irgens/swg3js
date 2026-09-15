// The lead a gun takes on a moving target: the bolt and the target meet where and when it says.
import assert from 'node:assert/strict';
import { interceptTime, leadPoint } from '../../../src/combat/intercept.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// A target 600 m dead ahead, still: a 600 m/s bolt reaches it in a second.
ok(near(interceptTime({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 600)!, 1), 'a still target is met at range over speed');

// A target crossing at 100 m/s, 300 m ahead: the meeting point is where the bolt's speed can reach it.
{
  const rel = { x: 0, y: 0, z: 300 };
  const vel = { x: 100, y: 0, z: 0 };
  const t = interceptTime(rel, vel, 600)!;
  const p = leadPoint(rel, vel, t, { x: 0, y: 0, z: 0 });
  ok(t > 0 && near(Math.hypot(p.x, p.y, p.z), 600 * t, 1e-6), 'a crossing target is met where the bolt can be at that moment');
  ok(p.x > 0, 'the lead point is ahead of the target along its motion');
}

// A target running straight away faster than the bolt is never met; one slower is.
ok(interceptTime({ x: 0, y: 0, z: 200 }, { x: 0, y: 0, z: 700 }, 600) === null, 'a target outrunning the bolt is never met');
ok(near(interceptTime({ x: 0, y: 0, z: 200 }, { x: 0, y: 0, z: 400 }, 600)!, 1), 'a target running away slower is caught at the closing speed');

// A target coming head-on meets the bolt sooner than a still one would.
ok(near(interceptTime({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: -600 }, 600)!, 0.5), 'a head-on target meets the bolt halfway in time');

// The shooter's own point is the answer for a target on top of it.
ok(interceptTime({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 600) === 0, 'a target at the muzzle needs no lead');

console.log(`${checks} checks passed`);
