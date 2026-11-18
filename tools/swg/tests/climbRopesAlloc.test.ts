// Climbing II, phase 4 (maker A): on a rope, the swing's frame makes nothing and asks the engine nothing while it swings in the
// open (`climbRopesAllocOwn.ts`: the swing's step on one of the physics' steps a frame with A held and with nothing held, and the
// figure's place for it); a climb up and down the rope, its room asked again as the radius moves on, makes nothing either; the
// ropes nobody holds swing and are laid making nothing; and the rope's hand-over to the rig makes nothing (`driveRopeClips` on a
// stand-in rig, the loop's and the swing's times moving every frame: no name built and no number handed across a call). Twelve
// processes at once for each, every one asserted. Maker B: and the flight off the rope and the landing on a lip make nothing either.
//
// Run: node tools/swg/tests/climbRopesAlloc.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const file = fileURLToPath(new URL('./climbRopesAllocOwn.ts', import.meta.url));
/** What a frame may make, bytes (the harness's own constant, as the wave 4 suites allow). */
const PER_FRAME = 0.05;
const PROCESSES = 12;
interface Meas {
  bytes: number;
  frames: number;
  casts: number;
  clean: boolean;
}
function one(part: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', '--min-semi-space-size=64', '--max-semi-space-size=64', file], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ROPE_PART: part } });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).pop() ?? '';
      if (code !== 0 || !line.startsWith('{')) reject(new Error(`climbRopesAllocOwn.ts ${part} exited ${code}: ${out}`));
      else resolve(JSON.parse(line) as Record<string, unknown>);
    });
  });
}
const per = (m: Meas) => m.bytes / m.frames;
const swings = await Promise.all(Array.from({ length: PROCESSES }, () => one('swing')));
ok(swings.every((a) => a.holding && a.held && (a.amp as number) > 5 && a.modeSwing), `in all ${PROCESSES} processes the body is on the rope, swinging (pumped to ${Math.min(...swings.map((a) => a.amp as number)).toFixed(0)} degrees and more, playing the swing)`);
for (const k of ['pumped', 'still'] as const) {
  const m = swings.map((a) => a[k] as Meas);
  ok(m.every((x) => x.clean && x.casts === 0), `${k}: every window measured with no collection inside it, and the swing in the open asks the engine nothing (its room asked once, at the grab)`);
  ok(m.every((x) => per(x) <= PER_FRAME), `${k}: the swing's frame makes nothing (worst ${Math.max(...m.map(per)).toFixed(4)} bytes a frame over ${m[0].frames} frames, in every one of ${PROCESSES} processes)`);
}
const climbs = await Promise.all(Array.from({ length: PROCESSES }, () => one('climb')));
const cm = climbs.map((a) => a.meas as Meas);
ok(climbs.every((a) => a.holding && a.held) && cm.every((x) => x.clean && x.casts > x.frames / 100), `in all ${PROCESSES} processes the body climbed up and down the rope, its room asked again as it went (${Math.min(...cm.map((x) => x.casts))} asks and more over ${cm[0].frames} frames), every window clean`);
ok(cm.every((x) => per(x) <= PER_FRAME), `the climb's frame makes nothing, its asks of the room included (worst ${Math.max(...cm.map(per)).toFixed(4)} bytes a frame over ${cm[0].frames} frames, in every one of ${PROCESSES} processes)`);
const frees = await Promise.all(Array.from({ length: PROCESSES }, () => one('free')));
const fm = frees.map((a) => a.meas as Meas);
ok(frees.every((a) => a.ropes === 4 && a.swinging) && fm.every((x) => x.clean), `four ropes nobody holds swung and laid every frame in every process, every window clean`);
ok(fm.every((x) => per(x) <= PER_FRAME), `the free ropes' frame makes nothing (worst ${Math.max(...fm.map(per)).toFixed(4)} bytes a frame, in every one of ${PROCESSES} processes)`);
const clips = await Promise.all(Array.from({ length: PROCESSES }, () => one('clips')));
const km = clips.map((a) => a.meas as Meas);
ok(clips.every((a) => (a.calls as number) > 0) && km.every((x) => x.clean), "the rope's hand-over drove the rig in every process, every window clean");
ok(km.every((x) => per(x) <= PER_FRAME), `the rope's hand-over makes nothing, the flight's clip's included (worst ${Math.max(...km.map(per)).toFixed(4)} bytes a frame, in every one of ${PROCESSES} processes)`);
// Maker B: the flight off the rope and the landing on a lip (`climbRopesAllocOwn.ts`'s 'land': a cast a step against a stand-in
// world that makes nothing, the figure's place with tables of the landing clips' own shape), each window's frames inside one.
interface Air {
  per: number;
  frames: number;
  windows: number;
  lost: number;
  phase: boolean;
}
const lands = await Promise.all(Array.from({ length: PROCESSES }, () => one('land')));
for (const k of ['fly', 'land'] as const) {
  const m = lands.map((a) => a[k] as Air);
  const what = k === 'fly' ? "the flight's" : "the landing's";
  ok(m.every((x) => x.phase && x.windows >= 8), `${k}: in all ${PROCESSES} processes every window lay inside ${k === 'fly' ? 'a flight' : 'a landing'} (${Math.min(...m.map((x) => x.windows))} windows and more each, ${Math.max(...m.map((x) => x.lost))} at the most lost to a collection)`);
  ok(m.every((x) => x.per <= PER_FRAME), `${k}: ${what} frame makes nothing (worst ${Math.max(...m.map((x) => x.per)).toFixed(4)} bytes a frame, the cleanest long window's less the cleanest short one's over the ${m[0].frames} frames between, in every one of ${PROCESSES} processes)`);
}
console.log(`climbRopesAlloc: ${checks} checks passed`);
