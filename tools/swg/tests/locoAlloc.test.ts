// The speed classes' frame makes nothing (Animations I, wave 2a): `locoAllocOwn.ts`, the body's record driven as the
// player's update drives it (a steady jog; and a script of keys that changes way and class every few frames, with
// the taps that make a sprint, a jump out of it, a seat taken in the middle of one, a block and a blaster up), and a
// dozen other players' legs worked out each frame, run in twelve processes at once, each asserted under 0.05 bytes
// a frame with no collection. Twelve at once and every one asserted: which calls the compiler builds in, and so
// whether a number crossing one is boxed, turns on the load it compiles under.
//
// Run: node tools/swg/tests/locoAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./locoAllocOwn.ts', import.meta.url));
interface Answer {
  frames: number;
  steady: number;
  steadyScavenges: number;
  steadyLegs: number;
  busy: number;
  busyScavenges: number;
  busyLegs: number;
  busySprints: number;
  busySeats: number;
  busyDrops: number;
  busyEnded: number;
  busyMuted: number;
  peers: number;
  peerScavenges: number;
  peerCount: number;
  peerPicks: number;
  busyCarries: number;
  polish: number;
  polishScavenges: number;
  polishLegs: number;
  air: number;
  airScavenges: number;
  airFloats: number;
  airSunk: number;
}
const run = () =>
  new Promise<Answer>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file], { stdio: ['ignore', 'pipe', 'pipe'] });
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
const per = (made: number, frames: number) => (Math.max(0, made) / frames).toFixed(3);
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  ok(a.steadyLegs > a.frames && a.steadyScavenges === 0 && a.steady < 0.05 * a.frames, `process ${i + 1} of 12: a steady jog (the keys, the plan, the turn, the legs and their rate, the fade) makes ${Math.max(0, a.steady)} bytes over ${a.frames} frames (${per(a.steady, a.frames)} a frame)`);
  ok(a.busyLegs > a.frames && a.busySprints > 10_000 && a.busySeats > 1000 && a.busyDrops > 100 && a.busyEnded > 100 && a.busyMuted === 0 && a.busyScavenges === 0 && a.busy < 0.05 * a.frames, `process ${i + 1} of 12: ways and classes changing every few frames (${a.busySprints} frames of sprint, ${a.busySeats} seated, ${a.busyDrops} states let go, ${a.busyEnded} sprints ended by a fight's key with nothing muted) make ${Math.max(0, a.busy)} bytes (${per(a.busy, a.frames)} a frame)`);
  ok(a.peerCount === 12 && a.peerPicks > a.frames * 6 && a.peerScavenges === 0 && a.peers < 0.05 * a.frames, `process ${i + 1} of 12: the legs of ${a.peerCount} other players worked out each frame (${a.peerPicks} answers) make ${Math.max(0, a.peers)} bytes (${per(a.peers, a.frames)} a frame)`);
  ok(a.polishLegs > a.frames && a.busyCarries > a.frames && a.polishScavenges === 0 && a.polish < 0.05 * a.frames, `process ${i + 1} of 12: the polish's paces (walking sideways under each of its three choices, the dial moved every 512 frames; a gun in hand and none up at every pace, every kind's carry asked, ${a.busyCarries} frames; each pace's share of the locked rate a fraction) make ${Math.max(0, a.polish)} bytes (${per(a.polish, a.frames)} a frame)`);
  ok(a.airFloats > a.frames / 4 && a.airSunk > a.frames / 4 && a.airScavenges === 0 && a.air < 0.05 * a.frames, `process ${i + 1} of 12: the owner's air (a plain jump floating until it falls past its speed, the rope's float) and the treading sink, surfaced and diving, make ${Math.max(0, a.air)} bytes (${per(a.air, a.frames)} a frame; ${a.airFloats} frames floating, ${a.airSunk} sunk)`);
}
console.log(`\nlocoAlloc: ${checks} checks passed`);
