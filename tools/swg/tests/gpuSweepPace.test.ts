// The GPU port's performance step, its `sweepPace` (maker B), in node: the Effects switch's sweep in play on WebGPU.
//
// On WebGPU a batch of `World.sweepBatches` builds nothing on the main thread: it lists its objects for the warm-up
// (`patchWarm.ts`), which builds them on its own clock. Step 6 waited a frame after every batch of eight in play, as WebGL
// must (its batch compiles synchronously); at Mos Eisley's street that was some 960 frames, 13.5 to 28 s by the machine's
// load, for about 0.8 s of the warm-up's own work (its `listMs` and `buildMs`, read off the page). `sweepYieldPaced` waits
// a frame once `paceMs` of listing has gone by since the last wait (the warm-up's own in-play slice, `sliceInPlayMs`).
//
//  1. with `paceMs` nought (WebGL, and the switch off) and behind a screen it answers what `sweepYield` answers, to the bit;
//  2. in play with a pace it waits only once the listing has spent the pace;
//  3. what it saves over a sweep the size of the street's (some 7,800 objects in batches of eight, each batch's listing
//     the 0.47 ms a batch measured on the page): the frames waited, from one a batch to one a pace's worth of listing;
//  4. the sweep's guard and the runtime's answer as the game has them (`gpuOff.test.ts` holds that the WebGL line stands).
//
// Run: node tools/swg/tests/gpuSweepPace.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sweepYield, sweepYieldPaced } from '../../../src/world/loadingTune.ts';
import { DRAW_COST, DRAW_SWITCHES } from '../../../src/core/gpu/drawCost.ts';

let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};
const ROOT = join(import.meta.dirname, '..', '..', '..');

// ---------------------------------------------------------------- 1. nought, and behind a screen: sweepYield to the bit
{
  let same = 0;
  let asked = 0;
  for (const built of [0, 1, 5])
    for (const elapsed of [0, 0.5, 2.99, 3, 9.9, 10, 40])
      for (const behind of [false, true])
        for (const slice of [0, 10, 25])
          for (const pace of [0, 1, 3, 8]) {
            if (pace > 0 && !behind) continue;
            asked++;
            if (Object.is(sweepYieldPaced(built, elapsed, behind, slice, pace), sweepYield(built, elapsed, behind, slice))) same++;
          }
  ok(asked > 100 && same === asked, `with no pace, and behind a screen whatever the pace, it answers sweepYield's answer (${same} of ${asked})`);
}

// ---------------------------------------------------------------- 2. in play with a pace
{
  ok(!sweepYieldPaced(0, 0, false, 10, 3) && !sweepYieldPaced(0, 2.99, false, 10, 3), 'in play with a pace of 3 ms a batch within it goes straight on');
  ok(sweepYieldPaced(0, 3, false, 10, 3) && sweepYieldPaced(0, 40, false, 10, 3), 'and once the listing has spent the pace it waits a frame');
  ok(!sweepYieldPaced(7, 1, false, 10, 3), 'a batch that built programs does not wait on its own (on WebGPU no batch builds any; the warm-up does)');
  ok(sweepYield(0, 0, false, 10), 'where step 6 waited a frame after every batch in play');
}

// ---------------------------------------------------------------- 3. what it saves over the street's sweep
{
  const objects = 7800;
  const batch = 8;
  const perBatchMs = 0.47;
  const frames = (pace: number): number => {
    let waited = 0;
    let since = 0;
    for (let i = 0; i < objects; i += batch) {
      since += perBatchMs;
      if (sweepYieldPaced(0, since, false, 10, pace)) {
        waited++;
        since = 0;
      }
    }
    return waited;
  };
  const step6 = frames(0);
  const paced = frames(3);
  ok(step6 === Math.ceil(objects / batch), `step 6's sweep waits a frame after every batch (${step6} frames)`);
  ok(paced <= Math.ceil((objects / batch) * perBatchMs / 3) + 1 && paced * 6 < step6, `paced at 3 ms it waits once a pace's worth of listing (${paced} frames, ${(step6 / paced).toFixed(1)} times fewer)`);
  ok(frames(1) > paced && frames(1) < step6, `a pace of 1 ms waits more often than 3 ms and less than step 6 (${frames(1)})`);
}

// ---------------------------------------------------------------- 4. the switch and the game's wiring
{
  ok(DRAW_SWITCHES.includes('sweepPace') && DRAW_COST.sweepPace === true, 'sweepPace is one of the step\'s switches, on unless left off at load');
  const world = readFileSync(join(ROOT, 'src', 'world', 'world.ts'), 'utf8');
  ok(world.includes('if (GPU.webgpu && !behind && GPU.rt!.sweepPaceMs() > 0) {') && world.includes('if (sweepYieldPaced(built, t1 - sliceFrom, behind, LOADING_TUNE.sliceMs, GPU.rt!.sweepPaceMs())) {'), 'world.ts: the sweep asks the pace behind GPU.webgpu, in play alone, through the runtime');
  const start = readFileSync(join(ROOT, 'src', 'core', 'gpu', 'start.ts'), 'utf8');
  ok(/sweepPaceMs\(\) \{\s*\/\/[^\n]*\n\s*return DRAW_COST\.sweepPace \? WARM_TUNE\.sliceInPlayMs : 0;/.test(start), "start.ts: the runtime's pace is the warm-up's in-play slice with the switch on, nought with it off");
  const sw = readFileSync(join(ROOT, 'src', 'core', 'gpuSwitch.ts'), 'utf8');
  ok(sw.includes('sweepPaceMs(): number;'), 'gpuSwitch.ts: the runtime describes the pace for the WebGL path to call with a type and no import');
}

console.log(`gpuSweepPace: ${checks} checks passed`);
