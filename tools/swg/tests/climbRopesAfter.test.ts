// Climbing II, phase 4 (maker A): the rope's own digest. The course's rope piece stood as the game's `climbTest` stands it, a
// body run off its take-off edge at 30, 60, 144 and 240 frames a second, E tapped as it passes the rope, then on the rope: a
// still hang, a climb up, A pumping a swing, let alone, D, a climb down, and Space letting go on the swing into the pit. Every
// frame's numbers (the body's place and velocity, the rope's phase, mode, way down, give, angle, speed and drawn angle) hashed,
// at the round's shipped settings, so maker B and the phases after hold their switches at their other setting to it; and the
// same run with `climb.ropes` at 'off' (`CLIMB_ROPES_BEFORE`), where the rope piece is its column, which E never takes.
//
// Run: node tools/swg/tests/climbRopesAfter.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { climbCourse } from '../../../src/anim/climbCourse.ts';
import { climbRopesBefore, resetClimbTune, tuneClimb } from '../../../src/anim/climbTune.ts';
import { RATES, bodyAt, standPiece, tap } from './climbCourseBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The round's shipped settings, maker A's (recorded from this run's first pass, 2026-11-18). */
const SHIPPED = { digest: 'b7e362af52acf65eb54cf9138d724e8a4514cb6139d2c7c21b9555828186956a', frames: 8991 };
/** `climb.ropes` 'off': the rope piece its column. */
const OFF = { digest: '9daff97ece88da4b8c9746a452bc2730f07bfbe42b1d3faecce7ecfd8dcb193a', frames: 9051 };

interface Run {
  frames: number;
  held: boolean;
  climbed: number;
  most: number;
  letGo: boolean;
}

async function session(fps: number, h: ReturnType<typeof createHash>): Promise<Run> {
  const s = await standPiece(climbCourse({ pieces: ['rope'] }).pieces[0]);
  const { b } = bodyAt(s, 'run', fps);
  b.rope.ropes = s.ropes;
  const row = new Float64Array(14);
  let frames = 0;
  const rec = () => {
    const R = b.rope;
    row[0] = b.pos.x;
    row[1] = b.pos.y;
    row[2] = b.pos.z;
    row[3] = b.vel.x;
    row[4] = b.vel.y;
    row[5] = b.vel.z;
    row[6] = R.phase;
    row[7] = R.mode;
    row[8] = R.s;
    row[9] = R.e;
    row[10] = R.th;
    row[11] = R.om;
    row[12] = R.thDraw;
    row[13] = R.holding ? 1 : 0;
    h.update(new Uint8Array(row.buffer));
    frames++;
  };
  const run = (sec: number) => {
    const n = Math.round(sec * fps);
    for (let i = 0; i < n; i++) {
      b.frame(1 / fps);
      rec();
    }
  };
  const until = (sec: number, done: () => boolean) => {
    const n = Math.round(sec * fps);
    for (let i = 0; i < n && !done(); i++) {
      b.frame(1 / fps);
      rec();
    }
  };
  // Off the edge running, E tapped as the body passes the rope (2 m out from the edge).
  const rz = s.ropes.length ? s.ropes[0].az : 7 - 0.5;
  b.key('KeyW', true);
  until(3, () => b.pos.z > 4.5);
  tap(b, 'Space', fps);
  rec();
  until(2, () => b.pos.z > rz - 0.4 || b.rope.holding);
  b.key('KeyW', false);
  tap(b, 'KeyE', fps);
  rec();
  run(1);
  const held = b.rope.holding;
  const s0 = b.rope.s;
  b.key('KeyW', true);
  run(2);
  b.key('KeyW', false);
  const climbed = s0 - b.rope.s;
  b.key('KeyA', true);
  let most = 0;
  for (let i = 0; i < 5 * fps; i++) {
    b.frame(1 / fps);
    rec();
    most = Math.max(most, b.rope.amplitude());
  }
  b.key('KeyA', false);
  run(2);
  b.key('KeyD', true);
  run(2);
  b.key('KeyD', false);
  b.key('KeyS', true);
  run(3);
  b.key('KeyS', false);
  const wasHeld = b.rope.holding;
  tap(b, 'Space', fps);
  rec();
  const letGo = wasHeld && !b.rope.holding;
  run(3);
  return { frames, held, climbed, most, letGo };
}

// (Maker B: and with the let-go's landing at its other setting, 'plain', where this run's let-go into the pit, which meets no
// lip, is the very same let-go: maker A's digest to the bit.)
for (const [what, want, off] of [["at the round's shipped settings", SHIPPED, false], ["with `climb.ropeLand` at 'plain' (maker B's landings put back)", SHIPPED, false], ["with `climb.ropes` at 'off'", OFF, true]] as const) {
  resetClimbTune();
  if (what.includes("'plain'")) tuneClimb({ ropeLand: 'plain' });
  if (off) climbRopesBefore();
  const h = createHash('sha256');
  const runs: Run[] = [];
  for (const fps of RATES) runs.push(await session(fps, h));
  const digest = h.digest('hex');
  const frames = runs.reduce((n, r) => n + r.frames, 0);
  const rows = runs.map((r, i) => `${RATES[i]}: ${r.held ? `held, climbed ${r.climbed.toFixed(2)} m, swung to ${((r.most * 180) / Math.PI).toFixed(1)} degrees, ${r.letGo ? 'let go' : 'not let go'}` : 'never held'}`).join('; ');
  if (off) ok(runs.every((r) => !r.held), `${what}: E never takes the rope piece's column (${rows})`);
  else ok(runs.every((r) => r.held && r.climbed > 0.5 && r.most > 0.3 && r.letGo), `${what}: every rate grabbed the rope running off the edge, climbed, swung and let go (${rows})`);
  console.log(`     ${what}: ${frames} frames, digest ${digest}`);
  ok(frames === want.frames && digest === want.digest, `... and every frame of it is as it was to the bit (${frames} frames, the trace's digest ${digest.slice(0, 16)})`);
}
resetClimbTune();
console.log(`climbRopesAfter: ${checks} checks passed`);
