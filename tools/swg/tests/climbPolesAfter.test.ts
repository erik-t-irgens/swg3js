// Climbing II, phase 5 (poles): the round's own digest (`climbPolesAfter`). Maker A's part: the course's `poles` stood as the game's
// `climbTest` stands it, a body run at its left pole at 30, 60, 144 and 240 frames a second (`poleSession`'s 'climb', tools/swg/tests/
// climbPolesBody.ts): walked up to it with W and E held, W up, let alone, S down, A and D round it, W to its top and S to its bottom.
// Every frame's numbers of the body (its place, velocity and heading, the ledges' and the wall climb's phases) hashed:
//  - with every switch of the round at its other setting (`climbPolesBefore`), as the feedback round II's commit `5421344` drew it:
//    the digest recorded from that commit's own code, before a line of the round was written (2026-11-18: the wall climb takes the
//    pole and the ledges then hang from its top);
//  - at the round's shipped settings, with the round's own numbers of each frame beside them (the pole's phase, where the hands are
//    up it and round it, drawn and stepped, the way climbed and turned, where it last stopped), its digest recorded from this run.
// Maker B adds the round's other scenes to it (off the pole), each recorded at `5421344`'s own code before a line of maker B's was
// written (its climbing, its harness; only the course's layout file, which stands the poles' tops' row, and the scenes' script
// copied in), and at the shipped settings with maker B's own numbers of each frame beside maker A's:
//  - 'jump': the left pole grabbed and climbed, the view turned to the right pole 2 m off, Space (the jump off, caught on the way),
//    round it once, down, up, the crouch (the slide to the ground), a walk off: the brief's proof;
//  - 'top': the pole beside a platform climbed to its top and on onto the platform behind the body (the ledges' climb up);
//  - 'floor': the pole up through a floor's hole climbed to its top and on out onto the floor.
//
// Run: node tools/swg/tests/climbPolesAfter.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { climbPolesBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { RATES } from './climbCourseBody.ts';
import { poleSession, type PoleRun, type PoleScene } from './climbPolesBody.ts';
import type { TestBody } from './grappleBody.ts';
import { POLE_TOP_FLOOR, POLE_TOP_LIP } from '../../../src/anim/climbCourse.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** `5421344`'s own session (recorded at that commit, nothing of the round yet written): the switches' other settings must give it to the bit. */
const BEFORE: Record<PoleScene, { digest: string; frames: number }> = {
  climb: { digest: 'dce2c8d83f0ef800b231108b1e36cc08e80808d5979bc4247558b524cee11462', frames: 14457 },
  // (Maker B's, recorded 2026-11-18 at `5421344`'s own code in a scratch copy of that commit.)
  jump: { digest: 'bb63d2c9198b7b0147dde97f0707d797c9bad6616c372817554fd3338fb944ce', frames: 9433 },
  top: { digest: 'cc2a4f60efaa2f78bd0cb2da18459f3d2ee99184f2b9b9e378b5c06bc78e4e1b', frames: 3271 },
  floor: { digest: 'f6ac63556eacc38d7ed8fffced72ca8745ae3ef726b2cd23c6be24a663954a4b', frames: 3508 },
};
/** The round's shipped settings, maker A's (recorded from this run's first pass, 2026-11-18); maker B's from his first pass. */
const SHIPPED: Record<PoleScene, { digest: string; frames: number }> = {
  climb: { digest: 'e9a36c2c797eb301bed6691129018325418b6e7250ef2b6da6f276090ddb8a52', frames: 14457 },
  // (The fixer's, 2026-11-18: maker B's own was 64ada0a7…, which the makers' code still gives. Two mends moved it: the flight's
  // turn and ease on the frame's own step at 30, 144 and 240 (the catcher had written the shared frame record a physics step's
  // time), and the jump's way never toward the pole (the body grabs a few micrometres off the line the scene lays, so the view to
  // the right pole runs a hair toward the held one and is mirrored by about 1e-5).)
  jump: { digest: 'c61d7276692598360945dd048db95af55c424063055c01702265f2aabe6985d8', frames: 9433 },
  top: { digest: '0c1cc050fd7217e42bcf6ac8303e7b2a1c54ed9915bff3eea458b1bafaa6b99d', frames: 3271 },
  floor: { digest: '8aa4999678035f9548ebb05295e16fcf5b933b1de9667e86cba19ac927872447', frames: 3508 },
};

const MORE = new Float64Array(11);
const STOPS = ['', 'top', 'bottom', 'met'];
/** Maker B's numbers of a frame (his scenes only, so maker A's digest of his own scene is his to the bit). */
const MORE_B = new Float64Array(12);
const ENDS = ['', 'caught', 'bar', 'lip', 'land', 'wall', 'water', 'fall', 'long', 'knocked', 'slid', 'swim', 'let go', 'top'];
/** The round's own numbers of a frame (the shipped run's). */
function more(h: ReturnType<typeof createHash>, scene: PoleScene) {
  return (b: TestBody) => {
    const P = b.pole;
    MORE[0] = P.phase;
    MORE[1] = P.s;
    MORE[2] = P.sDraw;
    MORE[3] = P.phi;
    MORE[4] = P.phiDraw;
    MORE[5] = P.heading;
    MORE[6] = P.climbed;
    MORE[7] = P.turned;
    MORE[8] = STOPS.indexOf(P.stop);
    MORE[9] = P.holding ? 1 : 0;
    MORE[10] = P.cameraCollider() === null ? 0 : 1;
    h.update(new Uint8Array(MORE.buffer));
    if (scene === 'climb') return;
    MORE_B[0] = P.vx;
    MORE_B[1] = P.vy;
    MORE_B[2] = P.vz;
    MORE_B[3] = P.flyT;
    MORE_B[4] = ENDS.indexOf(P.end);
    MORE_B[5] = P.sliding ? 1 : 0;
    MORE_B[6] = P.flights + 10 * P.catches + 100 * P.slides + 1000 * P.tops;
    MORE_B[7] = P.offX;
    MORE_B[8] = P.offY;
    MORE_B[9] = P.offZ;
    MORE_B[10] = b.bar.phase;
    MORE_B[11] = b.ledge.climbsFrom;
    h.update(new Uint8Array(MORE_B.buffer));
  };
}

/** Maker B: what each of his scenes must end as at the shipped settings, at every rate (its legs' ends, the body's counts). */
function shippedOk(scene: PoleScene, runs: PoleRun[], ends: { held: boolean; s: number; stop: string }[][], counts: { flights: number; catches: number; slides: number; tops: number; end: string; climbs: number }[]): boolean {
  if (scene === 'climb') {
    const lasts = ends.map((e) => e[0]);
    return runs.every((r) => r.held.every((x) => x === '') && r.heights[r.heights.length - 1] < 0.12) && lasts.every((e) => e.held);
  }
  if (scene === 'jump') return runs.every((r, i) => counts[i].flights === 1 && counts[i].catches === 1 && counts[i].slides === 1 && counts[i].end === 'slid' && r.heights[4] > 2.5 && Math.abs(r.heights[r.heights.length - 1]) < 0.06);
  if (scene === 'top') return runs.every((r, i) => counts[i].tops === 1 && counts[i].climbs === 1 && Math.abs(r.heights[r.heights.length - 1] - POLE_TOP_LIP) < 0.06 && r.held[r.held.length - 1] === '');
  return runs.every((r, i) => counts[i].tops === 1 && counts[i].climbs === 1 && Math.abs(r.heights[r.heights.length - 1] - POLE_TOP_FLOOR) < 0.06 && r.held[r.held.length - 1] === '');
}

const WHAT: Record<PoleScene, string> = {
  climb: "every rate's E grabs the pole (never the wall climb or the ledges) and the session ends on it at its bottom, the feet a hand's breadth over the ground",
  jump: "every rate jumps off the left pole once, is caught by the right one 2 m off on the way, slides down it to the ground and walks off (one flight, one catch, one slide)",
  top: "every rate climbs the pole to its top and the ledges' climb up takes the body onto the platform behind it, standing at its top",
  floor: "every rate climbs the pole to its top and the ledges' climb up takes the body out of the hole onto the floor, standing at its top",
};

for (const scene of ['climb', 'jump', 'top', 'floor'] as const) {
  for (const off of [true, false]) {
    resetClimbTune();
    if (off) climbPolesBefore();
    const h = createHash('sha256');
    const h2 = createHash('sha256');
    const runs: PoleRun[] = [];
    const ends: { held: boolean; s: number; stop: string }[][] = [];
    const counts: { flights: number; catches: number; slides: number; tops: number; end: string; climbs: number }[] = [];
    for (const fps of RATES) {
      const legEnds: { held: boolean; s: number; stop: string }[] = [];
      runs.push(
        await poleSession(scene, fps, h, off ? null : more(h2, scene), (r) => {
          const P = r.b.pole;
          legEnds.push({ held: P.holding, s: P.s, stop: P.stop });
          counts.push({ flights: P.flights, catches: P.catches, slides: P.slides, tops: P.tops, end: P.end, climbs: r.b.ledge.climbsFrom });
        }),
      );
      ends.push(legEnds);
    }
    const frames = runs.reduce((n, r) => n + r.frames, 0);
    const base = h.digest('hex');
    const own = createHash('sha256').update(base).update(h2.digest('hex')).digest('hex');
    const rows = runs.map((r, i) => `${RATES[i]}: feet ${r.heights.map((v) => v.toFixed(2)).join('/')}${r.held.some((x) => x) ? ` (${r.held.join(',')})` : ''}`).join('; ');
    if (off) {
      console.log(`     ${scene}, the round's switches at their other settings: ${frames} frames, digest ${base}`);
      // (Maker A's scene tops out onto a hang from the pole's top; maker B's take the pole by the wall climb too, whatever then follows.)
      const offOk = scene === 'climb' ? runs.every((r) => r.held[0] === 'wall' && r.held[r.held.length - 1] === 'ledge') : runs.every((r) => r.held[0] === 'wall');
      ok(offOk, `${scene}: with the round's switches at their other settings every rate's E and W take the pole by the wall climb${scene === 'climb' ? ', which tops out onto a hang from its top' : ''} (${rows})`);
      ok(frames === BEFORE[scene].frames && base === BEFORE[scene].digest, `${scene}: ... and every frame of it is the feedback round II commit's to the bit (${frames} frames, the trace's digest ${base.slice(0, 16)})`);
    } else {
      console.log(`     ${scene}, at the round's shipped settings: ${frames} frames, digest ${own}`);
      const told = scene === 'climb' ? '' : `; ${counts.map((c, i) => `${RATES[i]}: ${c.flights} jump, ${c.catches} caught, ${c.slides} slid, ${c.tops} topped, ends '${c.end}'`).join('; ')}`;
      ok(shippedOk(scene, runs, ends, counts), `${scene}: at the shipped settings ${WHAT[scene]} (${rows}${told})`);
      ok(frames === SHIPPED[scene].frames && own === SHIPPED[scene].digest, `${scene}: ... and every frame of it, with the round's own numbers, is as it was to the bit (${frames} frames, ${own.slice(0, 16)})`);
    }
  }
}
resetClimbTune();
console.log(`climbPolesAfter: ${checks} checks passed`);
