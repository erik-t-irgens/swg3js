// The Course tool makes nothing in a frame (the race drawer's first wave, DESIGN.md §2.11): `editorAllocOwn.ts course`, the
// tool armed over a 400-node circuit with its six gates, its frame and overlay (every course projected, the picked one's
// diamonds, width lines, grabbers and gates laid out and hovered) and the marks drawn -- editing with the cursor on a node,
// a node's diamond dragged, the gates mode hovering a gate, a draft of three clicks drawn with the aim -- run in twelve
// processes at once, each window asserted under 0.05 bytes a frame with no collection. A held edit's course made again at
// `previewHz` is a stamp's work, measured apart (`previewBytes`) and said, never held to the frame's line.
//
// Run: node tools/swg/tests/courseAlloc.test.ts
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
  gatesMade: number;
  gatesScavenges: number;
  draftMade: number;
  draftScavenges: number;
  nodes: number;
  gateCount: number;
  lines: number;
  marks: number;
  grabbed: string;
  gatesHot: number;
  draftPoints: number;
  previewBytes: number;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'course'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  ok(a.nodes === 400 && a.gateCount >= 3 && a.marks === 1200 && a.scavenges === 0 && a.made < 0.05 * a.frames, `process ${i + 1} of 12: a 400-node circuit with ${a.gateCount} gates drawn (${a.lines} lines, ${a.marks} handles), the cursor on a node, makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per(a.made)} a frame)`);
  ok(a.grabbed === 'node' && a.dragScavenges === 0 && a.dragMade < 0.05 * a.frames, `process ${i + 1} of 12: a node's diamond dragged makes ${Math.max(0, a.dragMade)} bytes (${per(a.dragMade)} a frame)`);
  ok(a.gatesHot === 1 && a.gatesScavenges === 0 && a.gatesMade < 0.05 * a.frames, `process ${i + 1} of 12: the gates mode hovering gate 1 makes ${Math.max(0, a.gatesMade)} bytes (${per(a.gatesMade)} a frame)`);
  ok(a.draftPoints === 3 && a.draftScavenges === 0 && a.draftMade < 0.05 * a.frames, `process ${i + 1} of 12: a draft of three clicks drawn with the aim makes ${Math.max(0, a.draftMade)} bytes (${per(a.draftMade)} a frame)`);
}
const pb = all.map((a) => a.previewBytes).sort((x, y) => x - y);
console.log(`note the preview's tick (a held edit's course made again, a stamp's work at previewHz): ${Math.round(pb[pb.length >> 1] / 1024)} KB for the 400-node course`);

console.log(`\ncourseAlloc: ${checks} checks passed`);
