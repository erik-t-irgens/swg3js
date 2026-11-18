// Climbing II, Smoothness III (maker B): a ladder climbed on its cycle (item 4b), a free hang's hop up and drop (item 4) and a walk
// under a beam and a slab with the duck's clearance and the opening's probe (items 3 and 3b) make no more a frame than the same
// frames with this round's maker B switches at their other setting (`smooth3BAllocOwn.ts`, twelve processes at once for each,
// four of each other setting, every one asserted): what their frames carry beyond the engine's own casts is nothing of theirs.
// The ladder's and the walk's frames hold the engine's every-frame queries (the hang's look for the next rung, the walk's body
// and the duck's probes), whose wrappers the engine makes, so they are compared with the same frames before and allowed the
// engine's share of the opening's two extra queries (a start-clear test and a cast, under a roof only); the free hop's frames
// with a braced hop's off a wall (a free hang could not hop up before). And (the review's) the hang's own hand-over of its
// clips to the rig (`driveHangClips`, handed a rig of the test's that makes nothing, so the hand-over's own share shows) in
// this round's new states against the plain hang's.
//
// Run: node tools/swg/tests/smooth3BAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./smooth3BAllocOwn.ts', import.meta.url));
interface Part {
  bytes: number;
  frames: number;
  clean: boolean;
}
interface Answer {
  part: string;
  before: boolean;
  hanging: boolean;
  made: number;
  marks: number;
  dirty: number;
  meas: Part;
}
const one = (part: string, mode: string, kind = '') =>
  new Promise<Answer>((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, S3B_PART: part, S3B_MODE: mode, ...(kind ? { S3B_KIND: kind } : {}) } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`smooth3BAllocOwn.ts exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Answer);
    });
  });
const PROCESSES = 12;
const per = (p: Part) => p.bytes / p.frames;
/** The engine's wrappers for the opening's two extra queries a frame under a roof, at the most (a cast's and a test's). */
const OPENING_ENGINE = 1600;
for (const part of ['ladder', 'free', 'body', 'hang']) {
  // (The hang's: four processes each of the cycle, the free hop's arms and an arc's move, twelve at once.)
  const kinds = ['cycle', 'arms', 'arc'];
  const all = await Promise.all([...Array.from({ length: PROCESSES }, (_v, i) => one(part, 'shipped', part === 'hang' ? kinds[i % 3] : '')), ...Array.from({ length: 4 }, () => one(part, 'before'))]);
  const now = all.slice(0, PROCESSES);
  const before = all.slice(PROCESSES);
  const worst = Math.max(...now.map((a) => per(a.meas)));
  const was = Math.max(...before.map((a) => per(a.meas)));
  ok(now.every((a) => a.meas.clean) && before.every((a) => a.meas.clean), `${part}: every process measured clean (collections inside ${now.map((a) => a.dirty).join(', ')})`);
  if (part === 'ladder') {
    ok(now.every((a) => a.hanging && a.made === 8 && a.marks === 1) && before.every((a) => a.marks === 0), `ladder: in all ${PROCESSES} processes the ladder is climbed up and down on its cycle (and on the rung's before)`);
    // (The phase 3 fix round's: these frames are the engine's wrappers, near thirteen kilobytes a frame, and in about one process
    // in a hundred, at 955fb04 as since, the cycle's frames come out some 6% over the rest, a compile of their own (measured: 1 of
    // 224 processes over 13,300 bytes at 955fb04, 13,644 the most, against a median of 12,897). The worst of twelve against the worst
    // of four within a twentieth failed one run in ten or so; so the typical frame is held to the rung's within a twentieth, the
    // median against the median, and every process within a tenth of the rung's worst.)
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1];
    const mid = median(now.map((a) => per(a.meas)));
    const wasMid = median(before.map((a) => per(a.meas)));
    ok(mid <= wasMid * 1.05 && worst <= was * 1.1, `ladder: the cycle's frames make no more than the rung's (the median ${mid.toFixed(0)} bytes a frame against ${wasMid.toFixed(0)}, within a twentieth; the worst ${worst.toFixed(0)} against ${was.toFixed(0)}, within a tenth: the hang's every-frame look for the next rung, the engine's)`);
  } else if (part === 'free') {
    ok(now.every((a) => a.hanging && a.made >= 28 && a.marks >= 14), `free: in all ${PROCESSES} processes a free hang hops up on its own move and drops down again (moves ${now.map((a) => a.made).join(', ')}; free hops ${now.map((a) => a.marks).join(', ')})`);
    ok(worst <= was, `free: a free hop's and drop's frames make no more than a braced hop's off a wall (worst ${worst.toFixed(0)} bytes a frame against ${was.toFixed(0)}: the move's own engine casts)`);
  } else if (part === 'hang') {
    // The review's: the hang's clips handed to the rig in the round's new states make what the plain hang's do and no more (the
    // rig's own mixer's; a clip's name made anew every frame, or a seek handed across a call, would show here).
    ok(now.every((a) => a.hanging && a.made === 24 && a.marks === 1), `hang: in all ${PROCESSES} processes the game's driveHangClips ran the cycle's, the free hop's arms' and the arc's states`);
    ok(worst <= was + 2, `hang: the cycle's, the free hop arms' and the arc's hand-over of the clips make no more than the plain hang's (worst ${worst.toFixed(1)} bytes a frame against ${was.toFixed(1)})`);
  } else {
    ok(now.every((a) => a.made === 8 && a.marks > 0), `body: in all ${PROCESSES} processes the walk ducks under the beam and lies down under the slab`);
    ok(worst <= was + OPENING_ENGINE, `body: the duck's clearance and the opening's probe make no more than before but the engine's own answers to the opening's two queries (worst ${worst.toFixed(0)} bytes a frame against ${was.toFixed(0)}, at most ${OPENING_ENGINE} more)`);
  }
}
console.log(`smooth3BAlloc: ${checks} checks passed`);
