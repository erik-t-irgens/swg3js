// The no-spawn zone tool and the seat snap make nothing in a frame (Map-maker II's twelfth wave, DESIGN.md §2.0 rule 7):
// `editorAllocOwn.ts zones`, the tool armed with three zones drawn (a circle, a rectangle and an outline) and one picked,
// the outlines projected at their ground and the picked one's square laid out and picked, the marks drawn, and beside each
// frame the snap a chair or a table in hand asks over forty sitters; then a rectangle dragged out; then an outline of three
// clicks under way -- run in twelve processes at once, each asserted under 0.05 bytes a frame with no collection.
//
// Run: node tools/swg/tests/zonesAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  made: number;
  scavenges: number;
  rectMade: number;
  rectScavenges: number;
  draftMade: number;
  draftScavenges: number;
  zones: number;
  rectOn: boolean;
  draftPoints: number;
  draftDrawn: number;
  snapped: boolean;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'zones'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const line = out.trim().split('\n').pop() ?? '';
      if (code !== 0) {
        const lines = err.trim().split('\n');
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
  ok(a.zones === 3 && a.snapped && a.scavenges === 0 && a.made < 0.05 * a.frames, `process ${i + 1} of 12: three zones drawn, one picked, a chair snapping to its sitters, make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per(a.made)} a frame)`);
  ok(a.rectOn && a.rectScavenges === 0 && a.rectMade < 0.05 * a.frames, `process ${i + 1} of 12: a rectangle dragged out makes ${Math.max(0, a.rectMade)} bytes (${per(a.rectMade)} a frame)`);
  ok(a.draftPoints === 3 && a.draftDrawn === 4 && a.draftScavenges === 0 && a.draftMade < 0.05 * a.frames, `process ${i + 1} of 12: an outline of three points under way, drawn with the aim, makes ${Math.max(0, a.draftMade)} bytes (${per(a.draftMade)} a frame)`);
}

console.log(`\nzonesAlloc: ${checks} checks passed`);
