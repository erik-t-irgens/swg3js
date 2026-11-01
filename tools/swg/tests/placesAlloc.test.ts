// The places tool makes nothing in a frame (Map-maker II's eighth wave, DESIGN.md §2.0 rule 7): `editorAllocOwn.ts places`,
// the tool armed with three places drawn (a circle, a rectangle and an outline, the circle no-build) and one picked, the
// outlines projected at their ground and the picked one's square laid out and picked, the marks drawn and the places' index
// asked as a ghost asks it every frame; then the picked place's square dragged; then an outline of three clicks under way --
// run in twelve processes at once, each asserted under 0.05 bytes a frame with no collection.
//
// Run: node tools/swg/tests/placesAlloc.test.ts
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
  dragMade: number;
  dragScavenges: number;
  draftMade: number;
  draftScavenges: number;
  places: number;
  bad: number;
  dragging: boolean;
  draftPoints: number;
  draftDrawn: number;
  asked: boolean;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'places'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  ok(a.places === 3 && a.bad === 1 && a.asked && a.scavenges === 0 && a.made < 0.05 * a.frames, `process ${i + 1} of 12: three places drawn (one in bad), one picked, the index asked, make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per(a.made)} a frame)`);
  ok(a.dragging && a.dragScavenges === 0 && a.dragMade < 0.05 * a.frames, `process ${i + 1} of 12: its square dragged makes ${Math.max(0, a.dragMade)} bytes (${per(a.dragMade)} a frame)`);
  ok(a.draftPoints === 3 && a.draftDrawn === 4 && a.draftScavenges === 0 && a.draftMade < 0.05 * a.frames, `process ${i + 1} of 12: an outline of three points under way, drawn with the aim, makes ${Math.max(0, a.draftMade)} bytes (${per(a.draftMade)} a frame)`);
}

console.log(`\nplacesAlloc: ${checks} checks passed`);
