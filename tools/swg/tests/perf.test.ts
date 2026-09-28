// The frame report (src/core/perf.ts, src/core/perfMath.ts): percentiles of known samples; the A/B
// schedule alternating exactly and throwing away the first block after each flip, and a whole run
// against a switch whose frames are timed by hand; the report's shape; the milliseconds of every
// section and pass on a clock of the test's own; a section left open failing loudly; the timing off
// touching nothing; a report covering only the timed frames at the head of the ring, and a gauge its
// newest value; frames of play only, a paused frame going into nothing and being counted; a wait
// always for a fresh window, and a ring made long enough at once; the GPU timer (on a stand-in context)
// never nesting inside another timer's query, never stalling on a query that was never begun, and
// summing nothing of a paused frame; the skeleton and bone-upload counts; the flight's trace; the
// census; the marks' storage surviving a browser that keeps nothing; and nothing allocated on a frame
// (run with node --expose-gc for that one), measured as young-generation bytes, which is what catches
// garbage made and dropped inside a frame, beside a check that nothing is kept.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import * as THREE from 'three';
import { abKeep, abLength, abSide, formatAb, formatReport, percentileSorted, spreadOf } from '../../../src/core/perfMath.ts';
import { censusOf, CNT, PASS, PERF, perf, PERF_SWITCHES, PERF_TUNE, readMarks, registerPerfSwitch, SEC, writeMark } from '../../../src/core/perf.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const tick = () => new Promise<void>((r) => setImmediate(r));

// A clock of our own, so every frame's time and every section's is chosen rather than measured: the
// recording's `performance.now()` reads it, and a body moves it on to spend time inside a section.
// It stays a small integer, so reading it makes no garbage of its own. The real clock is kept for the
// one check that measures what the calls themselves cost.
const realNow = performance.now.bind(performance);
let clock = 1000;
Object.defineProperty(performance, 'now', { value: () => clock, configurable: true, writable: true });
const spend = (ms: number) => {
  clock += ms;
};
const frame = (ms: number, calls = 100, body?: () => void) => {
  perf.frameStart(clock);
  body?.();
  clock += ms;
  perf.frameEnd(clock, calls);
};
/** A frame the game did not simulate (the Escape menu up): drawn, and handed to the report as not played. */
const pausedFrame = (ms: number, calls = 999, body?: () => void) => {
  perf.frameStart(clock);
  body?.();
  clock += ms;
  perf.frameEnd(clock, calls, false);
};

// ---------------------------------------------------------------------------------------------
// Percentiles.
{
  const xs = new Float64Array(100);
  for (let i = 0; i < 100; i++) xs[99 - i] = i + 1; // 100 down to 1: the spread must not care about order
  const s = spreadOf(xs, 100);
  ok(s.n === 100 && s.p50 === 50 && s.p95 === 95 && s.max === 100 && near(s.mean, 50.5), 'the samples 1..100: p50 50, p95 95, max 100, mean 50.5 (nearest rank)');
  ok(xs[0] === 100 && xs[99] === 1, 'the samples are left in the order they were taken');
  const one = spreadOf([7], 1);
  ok(one.p50 === 7 && one.p95 === 7 && one.max === 7 && one.mean === 7, 'one sample is every percentile');
  const none = spreadOf([], 0);
  ok(none.n === 0 && none.p50 === 0 && none.max === 0, 'no samples is all nought, not NaN');
  ok(percentileSorted([1, 2, 3, 4], 4, 0.5) === 2 && percentileSorted([1, 2, 3, 4], 4, 0.95) === 4 && percentileSorted([1, 2, 3, 4], 4, 0) === 1, 'nearest rank on four samples');
  const scratch = new Float64Array(200);
  const s2 = spreadOf([3, 1, 2], 3, scratch);
  ok(s2.p50 === 2 && s2.max === 3, 'a scratch buffer longer than the samples sorts only the samples');
}

// ---------------------------------------------------------------------------------------------
// The A/B schedule.
{
  const block = 12;
  const n = 480;
  let flips = 0;
  let keptA = 0;
  let keptB = 0;
  let sinceFlip = 0;
  let ok1 = true;
  for (let i = 0; i < n; i++) {
    const side = abSide(i, block);
    if (i > 0 && side !== abSide(i - 1, block)) {
      flips++;
      sinceFlip = 0;
    }
    // The first block after each flip (and at the start, which is a flip from whatever was there) is thrown away.
    if (sinceFlip < block && abKeep(i, block)) ok1 = false;
    if (sinceFlip >= block && sinceFlip < 2 * block && !abKeep(i, block)) ok1 = false;
    if (abKeep(i, block)) {
      if (side === 0) keptA++;
      else keptB++;
    }
    sinceFlip++;
  }
  ok(ok1, 'the first block after each flip is thrown away and the second kept');
  ok(flips === n / (2 * block) - 1, `the sides alternate exactly every two blocks (${flips} flips in ${n} frames)`);
  ok(keptA === keptB && keptA === n / 4, `each side keeps the same number of frames (${keptA} and ${keptB})`);
  ok(abSide(0, block) === 0 && abSide(23, block) === 0 && abSide(24, block) === 1 && abSide(47, block) === 1 && abSide(48, block) === 0, 'a for 24 frames, then b for 24, then a again');
  ok(abLength(240, 12) === 240 && abLength(241, 12) === 288 && abLength(1, 12) === 48 && abLength(0, 12) === 48, 'a run is whole cycles of four blocks');
  ok(abSide(5, 0) === abSide(5, 1) && abKeep(5, 0) === abKeep(5, 1), 'a block of nought is taken as one');
}

// ---------------------------------------------------------------------------------------------
// Off: the ring still holds the frame's own time and the draw count, and nothing else.
{
  PERF.on = false;
  for (let i = 0; i < 20; i++) frame(10, 50, () => perf.begin(SEC.world)); // begin with the timing off is nothing at all, so this is not left open
  const r = perf.report(20);
  ok(!r.timed && r.frames === 20 && near(r.frame.p50, 10, 1e-3) && r.calls === 50, 'timing off: the frame time and the draw calls are still recorded');
  ok(r.sections.length === 0 && r.passes.length === 0 && r.notes.some((x) => /timing is off/.test(x)), 'timing off: no sections, no passes, and a note saying so');
  // Every call returns at its first line: nothing is opened, timed, counted or drawn against a pass.
  perf.frameStart(clock);
  perf.begin(SEC.world);
  const opened = PERF.open[SEC.world];
  spend(5);
  perf.end(SEC.world);
  perf.count(CNT.syncBlocks, 3);
  perf.gauge(CNT.mobiles, 9);
  perf.passBegin(PASS.world);
  const pass = PERF.pass;
  perf.draw(new THREE.Object3D(), null);
  perf.passEnd(PASS.world, 100);
  ok(opened === 0 && PERF.t[SEC.world] === 0 && PERF.c.every((v) => v === 0) && pass === PASS.other, 'timing off: a begin opens nothing, an end times nothing, and counts, gauges, passes and draws write nothing');
  perf.frameEnd(clock, 1);
}

// ---------------------------------------------------------------------------------------------
// A section left open fails loudly, and the next frame is fine.
{
  PERF.on = true;
  let threw = '';
  try {
    frame(5, 1, () => perf.begin(SEC.world));
  } catch (err) {
    threw = String((err as Error).message);
  }
  ok(/world/.test(threw) && /never ended/.test(threw), `a section begun and never ended throws at the frame's end, naming it ("${threw}")`);
  threw = '';
  try {
    frame(5, 1, () => perf.end(SEC.stream));
  } catch (err) {
    threw = String((err as Error).message);
  }
  ok(/stream/.test(threw) && /without being begun/.test(threw), 'a section ended without being begun throws, naming it');
  perf.abandon();
  threw = '';
  try {
    frame(5, 1, () => {
      perf.begin(SEC.draw);
      perf.begin(SEC.draw);
    });
  } catch (err) {
    threw = String((err as Error).message);
  }
  ok(/begun twice/.test(threw), 'a section begun twice throws');
  perf.abandon();
  // A frame that threw half way: the loop's catch abandons it, and nothing of it is left open.
  perf.frameStart(clock);
  perf.begin(SEC.living);
  perf.abandon();
  let fine = true;
  try {
    frame(5);
  } catch {
    fine = false;
  }
  ok(fine, 'an abandoned frame leaves nothing open for the next one');
}

// ---------------------------------------------------------------------------------------------
// The report's shape, over frames that draw, count and time.
{
  PERF.on = true;
  perf.installSkeletonHook();
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone, new THREE.Bone()]);
  skeleton.computeBoneTexture();
  const skinned = { isSkinnedMesh: true } as unknown as THREE.Object3D;
  const instanced = { isInstancedMesh: true, count: 7 } as unknown as THREE.Object3D;
  const plain = new THREE.Object3D();
  const cascade0 = {};
  const cascade1 = {};
  const cascade2 = {};
  const body = () => {
    perf.begin(SEC.world);
    perf.begin(SEC.stream);
    spend(1);
    perf.end(SEC.stream);
    perf.end(SEC.world);
    perf.begin(SEC.draw);
    perf.begin(SEC.portals);
    perf.passBegin(PASS.shadows);
    for (let i = 0; i < 3; i++) perf.draw(skinned, cascade0);
    for (let i = 0; i < 2; i++) perf.draw(plain, cascade1);
    perf.draw(instanced, cascade2);
    spend(1);
    perf.passEnd(PASS.shadows, 600);
    perf.passBegin(PASS.world);
    perf.draw(plain, null);
    perf.draw(skinned, null);
    perf.draw(instanced, null);
    spend(1);
    perf.passEnd(PASS.world, 1000);
    for (let b = 0; b < 2; b++) {
      perf.passBegin(PASS.interior);
      perf.draw(skinned, null);
      spend(1);
      perf.passEnd(PASS.interior, 10);
    }
    perf.end(SEC.portals);
    perf.end(SEC.draw);
    // Two updates of one skeleton in a frame: two updates, one skeleton live, one upload.
    skeleton.update();
    skeleton.update();
    skeleton.boneTexture!.onUpdate!(skeleton.boneTexture!);
    perf.count(CNT.strays, 4);
    perf.gauge(CNT.portalMaterials, 321);
    perf.gauge(CNT.mobiles, 12);
  };
  // Each frame spends 5 ms in its sections and 15 or 35 more after them.
  for (let i = 0; i < PERF_TUNE.frames + 10; i++) frame(i % 10 === 0 ? 35 : 15, 1234, body);
  const r = perf.report();
  ok(r.frames === PERF_TUNE.frames && r.timed && r.paused === 0, `the report covers the last ${PERF_TUNE.frames} timed frames`);
  ok(r.frame.p50 === 20 && r.frame.max === 40 && r.frame.p95 === 40 && r.calls === 1234, 'the frame spread and the draw calls come out as the frames were made');
  ok(near(r.interval.p50, 20, 1e-6) && r.fps === 50, 'the interval is start to start, and the rate is taken from its middle');
  const names = r.sections.map((s) => s.name);
  ok(['world', 'stream', 'draw', 'portals', 'shadows', 'worldPass', 'interiors'].every((k) => names.includes(k)), `every section that took time is there (${names.join(', ')})`);
  ok(r.sections.find((s) => s.name === 'stream')?.depth === 1 && r.sections.find((s) => s.name === 'shadows')?.depth === 2, 'a section sits under its parent');
  const shadows = r.passes.find((p) => p.name === 'shadows');
  const world = r.passes.find((p) => p.name === 'world');
  const interior = r.passes.find((p) => p.name === 'interior');
  ok(!!shadows && shadows.draws === 6 && shadows.skinned === 3 && shadows.instanced === 1 && shadows.instances === 7 && shadows.triangles === 600 && shadows.calls === 1, 'the shadow pass: six draws, three skinned, one instanced holding seven');
  ok(!!world && world.draws === 3 && world.skinned === 1 && world.instanced === 1 && world.triangles === 1000, 'the world pass counted apart');
  ok(!!interior && interior.calls === 2 && interior.draws === 2 && interior.skinned === 2, 'two interior passes a frame are two calls of one kind');
  ok(r.shadow.casters.join(',') === '3,2,1' && r.shadow.strays === 4, 'casters per cascade, told apart by the camera, in the order met; strays');
  ok(r.groups.skeletons?.updated === 2 && r.groups.skeletons?.live === 1 && r.groups.skeletons?.uploads === 1, 'skeletons: two updates of one skeleton, one upload');
  const newest = (PERF.head - 1 + PERF.cap) % PERF.cap;
  const bytes = (skeleton.boneTexture!.image as { data: Float32Array }).data.byteLength;
  ok(bytes > 0 && PERF.ringC[CNT.skelBytes * PERF.cap + newest] === bytes, `the upload is counted at the bone texture's own size (${bytes} bytes)`);
  ok(r.groups.scene?.['portal materials'] === 321 && r.groups.scene?.mobiles === 12, 'a gauge reports its last value');
  ok(r.groups.streaming?.['chunk frames'] === 0, 'no chunk was made, so no chunk frames');
  ok('perf' in r.switches && r.switches.perf === true, 'the report lists the switches with their values');
  const text = formatReport(r);
  ok(/frame cpu/.test(text) && /interiors/.test(text) && /skeletons: /.test(text) && /casters per cascade 3 \/ 2 \/ 1/.test(text), 'the table prints the frame, the sections, the passes and the groups');
  ok(text.split('\n').every((line) => line.length <= 110), 'no line of the table is wider than a console');
}

// ---------------------------------------------------------------------------------------------
// The milliseconds themselves, spent inside the sections on the test's clock: what every later step's
// "after" is proven with.
{
  PERF.on = true;
  const living = new Float64Array(100);
  for (let i = 0; i < 100; i++) {
    perf.frameStart(clock);
    perf.begin(SEC.world);
    perf.begin(SEC.stream);
    spend(2);
    perf.begin(SEC.farRefresh);
    spend(5);
    perf.end(SEC.farRefresh);
    perf.end(SEC.stream);
    perf.begin(SEC.living);
    spend(100 - i); // 100 down to 1: the spread must come from the samples, not their order
    living[i] = 100 - i;
    perf.end(SEC.living);
    spend(1);
    perf.end(SEC.world);
    perf.begin(SEC.draw);
    perf.begin(SEC.portals);
    perf.passBegin(PASS.interior);
    spend(3);
    perf.passEnd(PASS.interior, 0);
    perf.passBegin(PASS.interior);
    spend(4);
    perf.passEnd(PASS.interior, 0);
    perf.end(SEC.portals);
    perf.end(SEC.draw);
    perf.frameEnd(clock, 10);
  }
  const r = perf.report(100);
  const sec = (name: string) => r.sections.find((s) => s.name === name);
  const lv = sec('living');
  ok(!!lv && lv.mean === 50.5 && lv.p50 === 50 && lv.p95 === 95 && lv.max === 100, 'a section of 1..100 ms: mean 50.5, p50 50, p95 95, max 100');
  ok(sec('farRefresh')?.mean === 5 && sec('stream')?.mean === 7 && sec('stream')?.max === 7, 'a section holds what was spent in it, its inner sections included (the stream 7 ms with its far refresh 5)');
  ok(sec('world')?.mean === 58.5 && sec('world')?.p50 === 58, 'the world is the stream, the living and the millisecond between them');
  const interior = r.passes.find((p) => p.name === 'interior');
  ok(!!interior && interior.ms === 7 && interior.calls === 2 && sec('interiors')?.mean === 7, 'two interior passes of 3 and 4 ms are one row of 7 ms and two calls, and the section says the same');
  ok(sec('portals')?.mean === 7 && sec('draw')?.mean === 7, 'the portals and the draw hold the passes under them');
  ok(r.frame.p50 === 65 && r.frame.max === 115, 'the frame is everything spent in it (15 ms plus the living)');
  ok(spreadOf(living, 100).p95 === lv!.p95, 'the report and the arithmetic agree on the same samples');
}

// ---------------------------------------------------------------------------------------------
// A report covers only the timed frames at the head of the ring, and a gauge is its newest value.
{
  PERF.on = true;
  for (let i = 0; i < 30; i++) frame(20);
  PERF.on = false;
  for (let i = 0; i < 10; i++) frame(50);
  PERF.on = true;
  for (let k = 1; k <= 5; k++) frame(10, 100, () => perf.gauge(CNT.portalMaterials, k * 100));
  const r = perf.report(120);
  ok(r.timed && r.frames === 5 && r.frame.max === 10 && r.notes.some((x) => /only 5 of 120/.test(x)), 'after timed, untimed and timed frames, a report covers the timed ones since the last untimed one and says how few');
  ok(r.groups.scene?.['portal materials'] === 500, 'a gauge that moves every frame reports the newest frame, not the oldest');
}

// ---------------------------------------------------------------------------------------------
// A wait is always for a fresh window: never answered from frames before it was asked for, however
// many there are. And a window longer than the ring makes the ring long enough at once.
{
  PERF.on = true;
  for (let i = 0; i < 200; i++) frame(10);
  let got = -1;
  void perf.whenTimed(5).then((n) => (got = n));
  await tick();
  ok(got === -1, 'with two hundred timed frames in hand, a wait for five still waits');
  for (let i = 0; i < 4; i++) frame(10);
  await tick();
  ok(got === -1, 'four frames later it is still waiting');
  frame(10);
  await tick();
  ok(got === 5, 'and the fifth answers it');

  perf.ensureFrames(240);
  ok(PERF.cap === 240 && PERF_TUNE.frames === 240, 'a window of 240 frames makes the ring 240 long at once, not on the next frame');
  let got2 = -1;
  void perf.whenTimed(240).then((n) => (got2 = n));
  for (let i = 0; i < 239; i++) frame(12);
  await tick();
  ok(got2 === -1, 'and its wait is for 240 fresh frames');
  frame(12);
  await tick();
  const r = perf.report(240);
  ok(got2 === 240 && r.frames === 240 && r.frame.max === 12 && !r.notes.some((x) => /only/.test(x)), 'which the report then covers whole');
  PERF_TUNE.frames = 120;
  perf.ensureFrames(120);
  ok(PERF.cap === 120, 'and back to 120');
}

// ---------------------------------------------------------------------------------------------
// Frames of play only: a paused frame goes into nothing (the ring, a wait, an A/B run, a trace) and
// is counted.
{
  PERF.on = true;
  let got = -1;
  void perf.whenTimed(10).then((n) => (got = n));
  for (let i = 0; i < 30; i++) pausedFrame(5);
  await tick();
  ok(got === -1 && !PERF.played, 'thirty paused frames do not count toward a wait for ten');
  for (let i = 0; i < 10; i++) frame(20, 10);
  await tick();
  let r = perf.report(10);
  ok(got === 10 && r.frames === 10 && r.frame.max === 20 && r.calls === 10 && r.paused === 0, 'ten frames of play answer it, and the report is theirs alone (the pause before them is not in its window)');
  for (let i = 0; i < 5; i++) frame(20, 10);
  for (let i = 0; i < 3; i++) pausedFrame(5);
  for (let i = 0; i < 5; i++) frame(20, 10);
  r = perf.report(10);
  ok(r.frames === 10 && r.paused === 3 && r.frame.max === 20 && r.notes.some((x) => /3 frames in between went by paused/.test(x)), 'a pause in the middle of the window is left out and counted');
  ok(/10 frames of play \(3 paused left out\)/.test(formatReport(r)), 'and the table says so at the top');

  // An A/B run does not move on while the game is paused.
  let value = 0;
  registerPerfSwitch('pauseTest', { get: () => value, set: (v) => (value = v as number), values: [0, 1] });
  const done = perf.ab('pauseTest', 0, 1, 48, 12);
  let played = 0;
  let seen = 0;
  while (PERF.run && seen < 1000) {
    seen++;
    if (seen % 3 === 0) pausedFrame(5, 999);
    else {
      frame(value === 0 ? 10 : 5, value === 0 ? 300 : 200);
      played++;
    }
  }
  const ab = await done;
  ok(played === 48 && ab.ran === 48 && ab.a.frames === 12 && ab.b.frames === 12, 'an A/B run counts only frames of play (48 of them among the paused)');
  ok(ab.a.frame.max === 10 && ab.b.frame.max === 5 && ab.a.calls === 300 && ab.b.calls === 200 && ab.notes.some((x) => /went by paused/.test(x)), 'no paused frame is in either side, and the run says how many went by');
  PERF_SWITCHES.delete('pauseTest');

  // A flight's trace does not record them either.
  perf.traceStart(100);
  for (let i = 0; i < 10; i++) {
    frame(20);
    pausedFrame(5);
  }
  const t = perf.traceEnd();
  ok(!!t && t.frames === 10 && t.paused === 10 && t.frame.max === 20, 'a trace keeps the frames of play and counts the paused');
}

// ---------------------------------------------------------------------------------------------
// A whole A/B run against a switch whose frames are timed by hand: a costs 10 ms, b costs 5, and the
// first frame after every flip costs 100 (the transient the thrown block is there for).
{
  PERF.on = true;
  let value = 0;
  let last = -1;
  const seen: number[] = [];
  registerPerfSwitch('test', { get: () => value, set: (v) => (value = v as number), values: [0, 1] });
  value = 7; // whatever it was before is put back at the end
  const done = perf.ab('test', 0, 1, 96, 12);
  let frames = 0;
  while (PERF.run && frames < 1000) {
    perf.frameStart(clock);
    seen.push(value);
    const flip = value !== last;
    last = value;
    clock += flip ? 100 : value === 0 ? 10 : 5;
    perf.draw(new THREE.Object3D(), null);
    perf.frameEnd(clock, value === 0 ? 300 : 200);
    frames++;
  }
  const r = await done;
  ok(frames === 96 && r.ran === 96, `the run took exactly its 96 frames (${frames})`);
  ok(seen.slice(0, 24).every((v) => v === 0) && seen.slice(24, 48).every((v) => v === 1) && seen.slice(48, 72).every((v) => v === 0), 'the switch held a, then b, then a, a block pair each');
  ok(r.a.frames === 24 && r.b.frames === 24, 'each side kept a quarter of the run');
  ok(r.a.frame.max === 10 && r.b.frame.max === 5, 'the transient after each flip fell in the thrown blocks and nowhere else');
  ok(r.a.calls === 300 && r.b.calls === 200 && r.delta.p50 === -5, 'each side reports its own draw calls, and b - a');
  ok(r.a.draws.other === 1 && r.b.draws.other === 1, 'with the timing on each side has its draws by pass');
  ok(value === 7, 'the switch is put back as it was');
  ok(/b - a: p50 -5/.test(formatAb(r)), 'the run prints as a table');
  let refused = '';
  await perf.ab('nothing', 0, 1, 48).catch((e: Error) => (refused = e.message));
  ok(/no switch named 'nothing'/.test(refused), 'an unknown switch is refused by name');
  PERF_SWITCHES.delete('test');
}

// The timing's own switch: an A/B of `perf` itself turns the recording on and off by the block.
{
  PERF.on = true;
  const done = perf.ab('perf', false, true, 48, 12);
  const timed: boolean[] = [];
  while (PERF.run) {
    perf.frameStart(clock);
    timed.push(PERF.timing);
    clock += 10;
    perf.frameEnd(clock, 10);
  }
  const r = await done;
  ok(timed.slice(0, 24).every((t) => !t) && timed.slice(24).every((t) => t), 'an A/B of the timing itself latches it per frame, off then on');
  ok(r.a.frames === 12 && r.b.frames === 12 && PERF.on === true, 'and puts it back on afterwards');
}

// ---------------------------------------------------------------------------------------------
// The trace (the flight): chunk frames told from the rest, and what the far tiles cost on them.
{
  PERF.on = true;
  perf.traceStart(100);
  for (let i = 0; i < 50; i++) {
    const chunk = i % 10 === 0;
    frame(chunk ? 120 : 20, 10, () => {
      if (chunk) {
        perf.count(CNT.chunksMade, 2);
        perf.begin(SEC.stream);
        perf.begin(SEC.farRefresh);
        spend(30);
        perf.end(SEC.farRefresh);
        perf.end(SEC.stream);
      }
      perf.count(CNT.syncBlocks, i === 3 ? 4 : 0);
      perf.count(CNT.programsPlay, i === 7 ? 1 : 0);
    });
  }
  const t = perf.traceEnd();
  ok(!!t && t.frames === 50 && t.chunkFrames === 5 && t.paused === 0, 'the trace keeps every frame and counts the five chunk frames');
  ok(!!t && t.chunkFrame.p50 === 150 && t.otherFrame.max === 20, 'chunk frames are reported apart from the rest');
  ok(!!t && t.farRefresh.p50 === 30 && t.farRefresh.max === 30, 'the far tiles\' refresh on the chunk frames is the time spent in it');
  ok(!!t && t.syncBlocks === 4 && t.programsBuilt === 1, 'terrain blocks made on the main thread and programs built are summed');
  ok(perf.traceEnd() === null, 'a trace ended twice gives nothing the second time');
  const r = perf.report(50);
  ok(r.groups.streaming?.['chunk frames'] === 5 && r.groups.streaming?.['chunk max ms'] === 150 && r.groups.streaming?.['far refresh max ms'] === 30 && r.groups.streaming?.['chunks made'] === 10, 'the report counts the chunk frames, what they cost and the far refresh in them');
  ok(formatReport(r).split('\n').every((line) => line.length <= 110), 'with the streaming line full, no line of the table is wider than a console');
}

// ---------------------------------------------------------------------------------------------
// The GPU timer, on a stand-in context that behaves as WebGL2 does: one timer query open at a time
// (a second begin is an error), a query answers when the stand-in says so, and a query that was never
// begun answers null.
{
  const TIME = 0x88bf;
  const AVAILABLE = 0x8867;
  const st = { current: null as object | null, errors: 0, available: true, ns: 2e6 };
  const begun = new Set<object>();
  const result = new Map<object, number>();
  const gl = {
    CURRENT_QUERY: 0x8865,
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: AVAILABLE,
    getExtension: (name: string) => (name === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT: TIME, GPU_DISJOINT_EXT: 0x8fbb } : null),
    getParameter: () => false,
    createQuery: () => ({}),
    beginQuery: (_target: number, q: object) => {
      if (st.current) {
        st.errors++;
        return;
      }
      st.current = q;
      begun.add(q);
    },
    endQuery: () => {
      if (!st.current) {
        st.errors++;
        return;
      }
      result.set(st.current, st.ns);
      st.current = null;
    },
    getQuery: () => st.current,
    getQueryParameter: (q: object, what: number) => {
      if (!begun.has(q)) {
        st.errors++;
        return null;
      }
      return what === AVAILABLE ? st.available : (result.get(q) ?? 0);
    },
  };
  perf.attach(gl as unknown as WebGL2RenderingContext);
  PERF_TUNE.gpu = true;
  PERF.on = true;
  const g = PERF.gpu;
  const passes = () => {
    perf.passBegin(PASS.shadows);
    perf.passEnd(PASS.shadows);
    perf.passBegin(PASS.world);
    perf.passEnd(PASS.world);
  };
  const gpuOf = (name: string) => perf.report(10).passes.find((p) => p.name === name)?.gpuMs ?? null;

  perf.resetGpu();
  for (let i = 0; i < 5; i++) frame(10, 1, passes);
  frame(10, 1); // the next frame's start reads the answers
  ok(gpuOf('shadows') === 2 && gpuOf('world') === 2 && g.frames === 5 && st.errors === 0, 'each pass is timed on the GPU, a query each, read off a frame later');

  // Another timer (the effects chain's own) holds a query across the passes: they go untimed, and its query is left alone.
  perf.resetGpu();
  const other = {};
  let untouched = true;
  for (let i = 0; i < 5; i++)
    frame(10, 1, () => {
      st.current = other;
      passes();
      if (st.current !== other) untouched = false;
      st.current = null;
    });
  frame(10, 1);
  ok(untouched && st.errors === 0 && g.held === 10 && g.pendLen === 0, 'inside another timer\'s query no pass begins one of its own, nor ends that one');
  ok(perf.report(10).notes.some((x) => /not timed on the GPU because another timer/.test(x)), 'and the report says why those passes have no GPU time');

  // A query the driver never began answers null: it is dropped, not waited on for ever.
  perf.resetGpu();
  const at = (g.pendHead + g.pendLen) % g.pendQ.length;
  g.pendQ[at] = {} as WebGLQuery;
  g.pendKind[at] = PASS.world;
  g.pendLast[at] = 1;
  g.pendLen++;
  for (let i = 0; i < 5; i++) frame(10, 1, passes);
  frame(10, 1);
  ok(g.dropped === 1 && g.pendLen === 0 && gpuOf('world') === 2, 'a query that was never begun is dropped and the ones after it are still read');

  // A paused frame's passes are drawn and timed, and summed into nothing.
  perf.resetGpu();
  st.errors = 0;
  for (let i = 0; i < 5; i++) {
    st.ns = 2e6;
    frame(10, 1, passes);
    st.ns = 50e6;
    pausedFrame(10, 1, passes);
  }
  frame(10, 1);
  ok(gpuOf('world') === 2 && g.frames === 5 && g.pendLen === 0 && st.errors === 0, 'the GPU sums hold the frames of play and none of the paused ones');

  // Start afresh while answers are still owed: those are read off into nothing.
  perf.resetGpu();
  st.available = false;
  st.ns = 50e6;
  for (let i = 0; i < 5; i++) frame(10, 1, passes);
  perf.resetGpu();
  st.available = true;
  st.ns = 7e6;
  for (let i = 0; i < 5; i++) frame(10, 1, passes);
  frame(10, 1);
  ok(gpuOf('world') === 7 && g.frames === 5 && g.dropped === 0, 'a reset throws away what was still owed from before it');
  ok(g.made <= 12, `the queries are made once and used again (${g.made} made for over sixty passes timed)`);

  PERF_TUNE.gpu = false;
  perf.attach(null);
  perf.resetGpu();
}

// ---------------------------------------------------------------------------------------------
// The census.
{
  const scene = new THREE.Scene();
  const mat = new THREE.MeshBasicMaterial();
  const geo = new THREE.BoxGeometry();
  const a = new THREE.Mesh(geo, mat);
  a.castShadow = true;
  a.layers.enable(31);
  const hiddenGroup = new THREE.Group();
  hiddenGroup.visible = false;
  hiddenGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
  const inst = new THREE.InstancedMesh(geo, mat, 9);
  inst.count = 5;
  scene.add(a, hiddenGroup, inst, new THREE.PointLight());
  const c = censusOf(scene);
  ok(c.nodes === 6 && c.visibleMeshes === 2 && c.instancedMeshes === 1 && c.instances === 5, 'the census counts what can be drawn and not what hides under a hidden parent');
  ok(c.casters === 1 && c.lights === 1 && c.materials === 1 && c.onActorLayer === 1, 'casters, lights, materials (once each) and the actor layer');
}

// ---------------------------------------------------------------------------------------------
// The marks: no storage at all, storage that throws, and a round trip.
{
  const mark = { planet: 'tatooine', zone: '', x: 1, y: 2, z: 3, yaw: 0.5, pitch: 0.1, zoom: 7, cell: 3, saved: 'now' };
  const g = globalThis as { localStorage?: unknown };
  delete g.localStorage;
  ok(Object.keys(readMarks()).length === 0 && writeMark('a', mark) === false, 'with no storage the marks read empty and a save says it was not kept');
  g.localStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  ok(Object.keys(readMarks()).length === 0 && writeMark('a', mark) === false, 'storage that throws is survived');
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  ok(writeMark('me-street', mark) && writeMark('theed', { ...mark, planet: 'naboo' }), 'two marks saved');
  const back = readMarks();
  ok(back['me-street']?.x === 1 && back['me-street']?.zoom === 7 && back['me-street']?.cell === 3 && back.theed?.planet === 'naboo', 'and read back as they were, the room with them');
  const { cell: _dropped, ...older } = mark;
  store.set('swg.perfMarks', JSON.stringify({ bad: { planet: 'x', x: 'no' }, badRoom: { ...mark, cell: -1 }, good: mark, older }));
  const read = readMarks();
  ok(!('bad' in read) && !('badRoom' in read) && 'good' in read && 'older' in read && read.older.cell === undefined, 'a mark that is not whole is dropped rather than trusted, and one saved before marks kept their room still reads');
  store.set('swg.perfMarks', '{not json');
  ok(Object.keys(readMarks()).length === 0, 'storage that is not JSON reads as no marks');
  delete g.localStorage;
}

// ---------------------------------------------------------------------------------------------
// Nothing allocated on a frame, timed, drawing, counting and updating a skeleton, and nothing kept.
{
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    PERF.on = true;
    const skeleton = new THREE.Skeleton([new THREE.Bone(), new THREE.Bone(), new THREE.Bone()]);
    skeleton.computeBoneTexture();
    const skinned = { isSkinnedMesh: true } as unknown as THREE.Object3D;
    const instanced = { isInstancedMesh: true, count: 3 } as unknown as THREE.Object3D;
    const cam = {};
    const inner = [SEC.stream, SEC.streamFar, SEC.layout, SEC.particles, SEC.sky, SEC.living];
    const body = () => {
      perf.begin(SEC.world);
      for (let k = 0; k < inner.length; k++) {
        perf.begin(inner[k]);
        spend(1);
        perf.end(inner[k]);
      }
      perf.end(SEC.world);
      perf.begin(SEC.draw);
      perf.passBegin(PASS.shadows);
      for (let i = 0; i < 20; i++) perf.draw(skinned, cam);
      perf.passEnd(PASS.shadows, 100);
      perf.passBegin(PASS.world);
      for (let i = 0; i < 50; i++) perf.draw(i % 2 ? instanced : skinned, null);
      perf.passEnd(PASS.world, 100);
      perf.end(SEC.draw);
      skeleton.update();
      perf.count(CNT.chunksMade, 0);
      perf.gauge(CNT.mobiles, 3);
    };
    // Warmed well past the engine's optimising tiers first: what the heap gains while code is being
    // optimised is the engine's, not the frame's.
    for (let i = 0; i < 5000; i++) frame(16, 100, body);
    for (let i = 0; i < 5000; i++) pausedFrame(16, 100, body);

    // What a frame makes and drops is collected before any heap total after a gc could see it, so the
    // allocation check counts the young generation's bytes across the frames, with no collection in
    // between (a collection would empty it and hide what was made; the observer says whether one ran).
    let gcs = 0;
    const obs = new PerformanceObserver((list) => {
      gcs += list.getEntries().length;
    });
    obs.observe({ entryTypes: ['gc'] });
    const youngSpace = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    const settle = () => new Promise<void>((r) => setTimeout(r, 20));
    const young = async (frames: number, played: boolean): Promise<{ perFrame: number; gcs: number }> => {
      for (let attempt = 0; ; attempt++) {
        gc();
        await settle();
        gcs = 0;
        const before = youngSpace();
        if (played) for (let i = 0; i < frames; i++) frame(16, 100, body);
        else for (let i = 0; i < frames; i++) pausedFrame(16, 100, body);
        const after = youngSpace();
        await settle();
        if (gcs === 0 || attempt >= 3) return { perFrame: (after - before) / frames, gcs };
      }
    };
    const timedYoung = await young(2000, true);
    ok(timedYoung.gcs === 0 && timedYoung.perFrame < 4, `a timed frame makes no garbage (${timedYoung.perFrame.toFixed(2)} bytes a frame over two thousand, the reading's own few hundred included)`);
    const pausedYoung = await young(2000, false);
    ok(pausedYoung.gcs === 0 && pausedYoung.perFrame < 4, `nor does a paused one (${pausedYoung.perFrame.toFixed(2)} bytes a frame)`);
    PERF.on = false;
    const offYoung = await young(2000, true);
    ok(offYoung.gcs === 0 && offYoung.perFrame < 4, `nor an untimed one (${offYoung.perFrame.toFixed(2)} bytes a frame)`);
    obs.disconnect();

    // And nothing is kept: the heap after a gc is where it was after ten thousand frames either way.
    PERF.on = true;
    gc();
    const start = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) frame(16, 100, body);
    gc();
    const grew = process.memoryUsage().heapUsed - start;
    ok(grew < 64 * 1024, `ten thousand timed frames keep nothing: the heap after a gc within 64 KB of where it was (${grew} bytes)`);
    PERF.on = false;
    gc();
    const start2 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) frame(16, 100, body);
    gc();
    const grew2 = process.memoryUsage().heapUsed - start2;
    ok(grew2 < 64 * 1024, `nor do ten thousand untimed frames (${grew2} bytes)`);

    // What the timing costs a frame with it off, at the game's own count of calls: about forty sections,
    // a dozen passes and a few counters (the draws and the skeletons are behind the flag at their call
    // sites, so off they are one test each). Every call returns at its first line. Timed on the real clock.
    const all = Object.values(SEC);
    const offFrame = () => {
      for (let k = 0; k < all.length; k++) {
        perf.begin(all[k]);
        perf.end(all[k]);
      }
      for (let k = 0; k < 12; k++) {
        perf.passBegin(PASS.interior);
        perf.passEnd(PASS.interior, 10);
      }
      perf.count(CNT.syncBlocks, 0);
      perf.gauge(CNT.mobiles, 3);
    };
    const t0 = realNow();
    for (let i = 0; i < 10000; i++) frame(16, 100, offFrame);
    const offUs = ((realNow() - t0) / 10000) * 1000;
    ok(offUs < 50, `a frame's worth of the report's calls costs ${offUs.toFixed(2)} µs with the timing off, under the design's 50`);
  } else console.log('skip nothing allocated on a frame: run with node --expose-gc to measure');
}

Object.defineProperty(performance, 'now', { value: realNow, configurable: true, writable: true });
console.log(`\n${checks} checks passed`);
