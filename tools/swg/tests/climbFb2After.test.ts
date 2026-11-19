// Climbing II, the feedback round II: the round's own digest (`climbFb2After`). Maker A's part: the course's `bars-3` stood as the
// game's `climbTest` stands it, a body run at it at 30, 60, 144 and 240 frames a second (`barSession`, tools/swg/tests/
// climbFb2Body.ts): a running jump with E onto the first bar, the swing let alone, A and D along the bar, W pumping it again, Space
// on the forward swing and the body run on. Every frame's numbers of the body and the bar (its place and velocity, the bar's
// phase, angle, speed, drawn angle, the hands' place along it and whether it holds) hashed:
//  - with every switch of the round at its other setting (`climbFb2Before`), as the ropes commit `5e8f23b` drew it: the digest
//    recorded from that commit's own code, before a line of the round was written (2026-11-18);
//  - at the round's shipped settings, with the round's own numbers of each frame beside them (the settle's damping, whether it
//    settles, the free hang's share and loop, and which bar the camera passes), its digest recorded from this run.
// Maker B adds the round's other scenes to it (the free hang's cue and hops, the ladders, the free hang's jump behind).
//
// Run: node tools/swg/tests/climbFb2After.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { climbFb2Before, resetClimbTune, LADDER_SWAY_LEGS } from '../../../src/anim/climbTune.ts';
import { BAR_FREE_LEFT, BAR_FREE_RIGHT } from '../../../src/player/barSwing.ts';
import { RATES } from './climbCourseBody.ts';
import { barSession, ledgeSession, type BarRun, type LedgeRun, type LedgeScene } from './climbFb2Body.ts';
import type { TestBody } from './grappleBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** `5e8f23b`'s own bar session (recorded at that commit, nothing of the round yet written): the switches' other settings must give it to the bit. */
const BARS_BEFORE = { digest: '38b20b434688ef27e44a7100d546bcedf1618b3aebecd7c7dfafcef098e44c21', frames: 9569 };
/** The round's shipped settings, maker A's (recorded from this run's first pass, 2026-11-18). */
const BARS_SHIPPED = { digest: 'e6c87227448b3b8e59bf2f201102bc87acbf22dbad195cd93db6c0a9d7d83fb3', frames: 10551 };

const MORE = new Float64Array(6);
/** The round's own numbers of a frame (the shipped run's). */
function more(h: ReturnType<typeof createHash>) {
  return (b: TestBody) => {
    const B = b.bar;
    MORE[0] = B.settling ? 1 : 0;
    MORE[1] = B.settleC;
    MORE[2] = B.free ? 1 : 0;
    MORE[3] = B.freeW;
    MORE[4] = B.freeState === BAR_FREE_LEFT ? 1 : B.freeState === BAR_FREE_RIGHT ? -1 : 0;
    MORE[5] = B.cameraCollider() === null ? 0 : B.cameraCollider() === B.bar.col ? 1 : 2;
    h.update(new Uint8Array(MORE.buffer));
  };
}

for (const off of [true, false]) {
  resetClimbTune();
  if (off) climbFb2Before();
  const h = createHash('sha256');
  const h2 = createHash('sha256');
  const runs: BarRun[] = [];
  for (const fps of RATES) runs.push(await barSession(fps, h, off ? null : more(h2)));
  const frames = runs.reduce((n, r) => n + r.frames, 0);
  const base = h.digest('hex');
  const own = createHash('sha256').update(base).update(h2.digest('hex')).digest('hex');
  const rows = runs.map((r, i) => `${RATES[i]}: ${r.grabbed ? 'grabbed' : 'never'}, settled ${Number.isFinite(r.settled) ? `${r.settled.toFixed(2)} s` : 'never'} from ${r.amp0.toFixed(1)} degrees, A ${r.shiftA.toFixed(2)} m, D ${r.shiftD.toFixed(2)} m, pumped to ${r.pumped.toFixed(1)}, ${r.letGo ? 'let go' : 'kept'}, ${r.catches} caught, ${r.landings} landed`).join('; ');
  if (off) {
    console.log(`     the round's switches at their other settings: ${frames} frames, digest ${base}`);
    ok(runs.every((r) => r.grabbed && r.settled === Infinity), `with the round's switches at their other settings every rate grabbed the bar and its swing never settled under 3 degrees in 8 s (${rows})`);
    ok(frames === BARS_BEFORE.frames && base === BARS_BEFORE.digest, `... and every frame of it is the ropes commit's to the bit (${frames} frames, the trace's digest ${base.slice(0, 16)})`);
  } else {
    console.log(`     at the round's shipped settings: ${frames} frames, digest ${own}`);
    ok(runs.every((r) => r.grabbed && r.settled < 5 && Math.abs(r.shiftA) > 0.8 && Math.abs(r.shiftD) > 0.8), `at the shipped settings every rate grabbed the bar, its swing let alone settled under 3 degrees within 5 s, and A and D moved the hands along it (${rows})`);
    ok(frames === BARS_SHIPPED.frames && own === BARS_SHIPPED.digest, `... and every frame of it is as it was to the bit (${frames} frames, the trace's digest ${own.slice(0, 16)})`);
  }
}
// ---- maker B's part: the free hang's cue and hop up, the free and braced ladders, the free hang's jump behind ----------------------
// Each scene (`ledgeSession`, tools/swg/tests/climbFb2Body.ts) at 30, 60, 144 and 240 frames a second: every frame's numbers of the
// body and the hang hashed; with the round's switches at their other settings each digest recorded from `5e8f23b`'s own code before
// a line of maker B's was written (2026-11-18, and the same from an export of that commit), at the shipped settings the body's
// trace beside the round's own numbers of each frame (the cue's rise and lift, the legs laid under and their share, the hips' lag,
// the free jumps behind), recorded from this run.
const LEDGE_BEFORE: Record<LedgeScene, { digest: string; frames: number }> = {
  freeCue: { digest: '2bb6cfdcb3b63387982113d1c7d161822d4c2f52fc4785d70730eaccdd757732', frames: 3470 },
  freeLadder: { digest: '6f30056cd7b4283de1b214ef88db5c37706bf5387c341d152116e216455a3c68', frames: 5377 },
  bracedLadder: { digest: '5b1ee90c47606409867882b7932c8fa185426d02d605bdacb1b45711d4dc1605', frames: 5204 },
  freeBehind: { digest: 'e30ca6b0dbc5f0197516a663ca00851e2422cd2002bc8549dfdbf298d7293786', frames: 2380 },
};
/** The shipped settings' (recorded from this run's first pass, 2026-11-18). */
const LEDGE_SHIPPED: Record<LedgeScene, { digest: string; frames: number }> = {
  freeCue: { digest: 'fc1bd31ff2a398b9096a6420301ab47356939826c4639d3b469864633cf220f6', frames: 3470 },
  freeLadder: { digest: '528ccf7a8ca942121638de6be03400c3c8f209972eb404295437ecd0eb265d04', frames: 5377 },
  bracedLadder: { digest: '7e9544abccead2e28f51a9757a7d4df83ddd4d5586d0d51ce6a1b66f44f06c0e', frames: 5204 },
  freeBehind: { digest: '94ba809e5cdb89c313d22c8b920951d5b955a020a86f3dd9058c1eeeef8ae032', frames: 2380 },
};
const LMORE = new Float64Array(10);
function ledgeMore(h: ReturnType<typeof createHash>) {
  return (b: TestBody) => {
    const L = b.ledge;
    LMORE[0] = L.cueRise;
    LMORE[1] = L.cueLift;
    LMORE[2] = L.legId === '' ? 0 : L.legId === LADDER_SWAY_LEGS ? 1 : 2;
    LMORE[3] = L.legAt;
    LMORE[4] = L.legW;
    LMORE[5] = L.swayX;
    LMORE[6] = L.swayY;
    LMORE[7] = L.swayZ;
    LMORE[8] = L.freeBehinds;
    LMORE[9] = L.freeCues;
    h.update(new Uint8Array(LMORE.buffer));
  };
}
for (const scene of ['freeCue', 'freeLadder', 'bracedLadder', 'freeBehind'] as const) {
  for (const off of [true, false]) {
    resetClimbTune();
    if (off) climbFb2Before();
    const h = createHash('sha256');
    const h2 = createHash('sha256');
    const runs: LedgeRun[] = [];
    for (const fps of RATES) runs.push(await ledgeSession(scene, fps, h, off ? null : ledgeMore(h2)));
    const frames = runs.reduce((n, r) => n + r.frames, 0);
    const base = h.digest('hex');
    const own = createHash('sha256').update(base).update(h2.digest('hex')).digest('hex');
    const rows = runs.map((r, i) => `${RATES[i]}: ${r.grabbed ? 'grabbed' : 'never'} ${r.seen.join('>')}${r.cued ? ', cued' : ''}, ends ${r.last}`).join('; ');
    const want = off ? LEDGE_BEFORE[scene] : LEDGE_SHIPPED[scene];
    if (off) {
      console.log(`     ${scene}, the round's switches at their other settings: ${frames} frames, digest ${base}`);
      ok(frames === want.frames && base === want.digest, `${scene}: with the round's switches at their other settings every frame is the ropes commit's to the bit (${frames} frames, ${base.slice(0, 16)}; ${rows})`);
    } else {
      console.log(`     ${scene}, at the round's shipped settings: ${frames} frames, digest ${own}`);
      ok(runs.every((r) => r.grabbed), `${scene}: at the shipped settings every rate grabbed (${rows})`);
      if (scene === 'freeBehind') ok(runs.every((r) => r.last === 'B'), `${scene}: at the shipped settings every rate's free hang jumped at the ledge behind and caught it`);
      else ok(base === LEDGE_BEFORE[scene].digest, `${scene}: the body's every frame as at the other settings (the round's change here is the figure's: ${base.slice(0, 16)})`);
      ok(frames === want.frames && own === want.digest, `${scene}: ... and every frame of it, with the round's own numbers, is as it was to the bit (${frames} frames, ${own.slice(0, 16)})`);
    }
  }
}
resetClimbTune();
console.log(`climbFb2After: ${checks} checks passed`);
