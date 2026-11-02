// The sky per place makes nothing in a frame (Map-maker II's ninth wave, DESIGN.md §2.0 rule 7): `placeSkyAlloc.ts`, the
// grade's ask of the places' index and its ease over a hundred places inside one town and then under the world row's look,
// what a change of look costs as the eye crosses a row of places (worked out once a change, measured apart), and the
// weather's `collect` half way through a place's weather kind's crossfade against the same call on plain rows -- run in twelve
// processes at once, each asserted under 0.05 bytes a frame with no collection.
//
// Run: node tools/swg/tests/placeSkyAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const file = fileURLToPath(new URL('./placeSkyAlloc.ts', import.meta.url));
interface Answer {
  frames: number;
  steady: number;
  steadyScavenges: number;
  world: number;
  worldScavenges: number;
  perChange: number;
  changes: number;
  crossScavenges: number;
  halves: number;
  halvesScavenges: number;
  plain: number;
  plainScavenges: number;
  halvesSeen: number;
  wantsHalves: boolean;
  eased: number;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0) {
        const lines = err.trim().split(/\r?\n/);
        reject(new Error(`the allocation child exited ${code}: ${lines.find((l) => /Error/.test(l))?.trim() ?? lines.pop() ?? line}`));
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
      }
    });
  });

const all = await Promise.all(Array.from({ length: 12 }, () => run()));
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  const per = (n: number) => (Math.max(0, n) / a.frames).toFixed(3);
  ok(a.eased > 0 && a.steadyScavenges === 0 && a.steady < 0.05 * a.frames, `process ${i + 1} of 12: the grade asked and eased inside a town's place makes ${Math.max(0, a.steady)} bytes over ${a.frames} frames (${per(a.steady)} a frame)`);
  ok(a.worldScavenges === 0 && a.world < 0.05 * a.frames, `process ${i + 1} of 12: in no place, under the world row's look, ${Math.max(0, a.world)} bytes (${per(a.world)} a frame)`);
  ok(a.changes > 50 && a.crossScavenges === 0 && a.perChange < 400, `process ${i + 1} of 12: the eye crossing a row of places changes the look ${a.changes} times at ${a.perChange} bytes a change`);
  ok(a.wantsHalves && a.halvesSeen > 0 && a.halvesScavenges === 0 && a.halves < 0.05 * a.frames, `process ${i + 1} of 12: the weather's fall half way through a place's kind, each half under its own kind, makes ${Math.max(0, a.halves)} bytes (${per(a.halves)} a frame)`);
  ok(a.plainScavenges === 0 && a.plain < 0.05 * a.frames, `process ${i + 1} of 12: the same call on plain rows ${Math.max(0, a.plain)} bytes (${per(a.plain)} a frame)`);
}

console.log(`\nplaceSkyAlloc: ${checks} checks passed`);
