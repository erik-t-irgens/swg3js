// The rooms' lights make nothing in a frame (Map-maker II's wave of the rooms' lights, DESIGN.md §2.0 rule 7): `lightsAllocOwn.ts`,
// one frame path a process (the pool's frame with lights flickering in every shape, one following a matrix and one held by
// the hand; the lights tool's frame -- its markers and a picked light's gizmo, F held raising it, R held turning it, Shift+R
// held tipping it, the gizmo's ground square dragged, F held on a spot the pool carries live), each path run in twelve
// processes at once and each process asserted under 0.05 bytes a frame with no collection. A path is measured in a process
// of its own because which call sites the compiler builds in turns on what it met first: measured after the pool and F held,
// the R hold read clean in every process while measured first it boxed two numbers a frame in one process of two (three's
// `Vector3.set` handed its numbers across a call left out of the tool's full frame method).
//
// Run: node tools/swg/tests/lightsAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const file = fileURLToPath(new URL('./lightsAllocOwn.ts', import.meta.url));
interface Answer {
  path: string;
  frames: number;
  made: number;
  scavenges: number;
  markers: number;
  picked: string;
  gizmo: boolean;
  live: string;
  held: boolean;
}
const run = (path: string) =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const line = out.trim().split('\n').pop() ?? '';
      if (code !== 0) {
        const lines = err.trim().split('\n');
        reject(new Error(`the allocation child (${path}) exited ${code}: ${lines.find((l) => /Error/.test(l))?.trim() ?? lines.pop() ?? line}`));
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`the allocation child (${path}) printed nothing that reads: ${line || '(nothing)'}`));
      }
    });
  });

const WORDS: Record<string, string> = {
  pool: "the pool's frame (four flickers, a light following a matrix, the hand's light)",
  tool: "the lights tool's frame (its markers and a picked light's gizmo)",
  lift: 'F held raising the picked light, the pool carrying it live',
  turn: 'R held turning it',
  tip: 'Shift+R held tipping it',
  drag: "the gizmo's ground square dragged",
  spotLive: 'F held on a spot, the pool carrying the spot and its target live',
};
const per = (n: number, frames: number) => (Math.max(0, n) / frames).toFixed(3);
for (const path of Object.keys(WORDS)) {
  const all = await Promise.all(Array.from({ length: 12 }, () => run(path)));
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const shaped = path === 'pool' ? a.live === 'candle-1' : a.markers === 9 && a.gizmo && a.held && a.picked === (path === 'spotLive' ? 'spot-1' : 'candle-1') && (path === 'tool' ? a.live === '' : a.live === a.picked);
    ok(shaped && a.scavenges === 0 && a.made < 0.05 * a.frames, `${path}, process ${i + 1} of 12: ${WORDS[path]} makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per(a.made, a.frames)} a frame)`);
  }
}

console.log(`\nlightsAlloc: ${checks} checks passed`);
