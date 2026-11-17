// Stairs II, item A: the step-up at every frame rate (`src/player/stepUp.ts`), on the real Rapier through the player's own
// movement (the grapple harness, `grappleBody.ts`, which runs the player's frame in the player's order):
//  - the step's height is the controller's own (`enableAutostep`'s first number, in the player and in the harness);
//  - under 'mended' risers of 0.21, 0.32, 0.42 and 0.48 m are climbed at a walk, a jog and a run at 30, 60, 144 and 240
//    frames a second, none stalling past a tenth of a second, each costing about the same over the floor at every rate; and down;
//  - a riser of 0.52 or 0.6 m (over the step's 0.5) is a wall at every pace and rate;
//  - under 'before' the faults are there to be seen: the walk stalls on 0.32 m risers at 144 frames a second, and the jog
//    climbs 0.52 m at 30;
//  - day one: under 'before' the body is 33d3e67's own, frame for frame at 30, 60, 144 and 240 frames a second (that commit's
//    harness read out of git; a recorded digest where git cannot answer);
//  - mutations of each part of the mend (the sync, the cast step, the wall's undoing, the step's height), each failing.
//
// Run: node tools/swg/tests/playerStepUp.test.ts (SWG3JS_NO_OLD=1 holds day one to the recorded digest alone)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Today from './grappleBody.ts';
import { JKA_RUN, flight } from './stairsWaveBody.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { STEP_HEIGHT } from '../../../src/player/stepUp.ts';
import { REPO, loadOldMany, loadTexts } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

/** The commit Stairs II started from. */
const PRE_WAVE = '33d3e67';
/** The digest of the day-one traces under 33d3e67's own harness (what a checkout with no history is held to). */
const BODY_TRACE = '9365566b62d18429';
type Harness = typeof import('./grappleBody.ts');
const FPS = [30, 60, 144, 240] as const;
/** Walking, jogging and running up stairs, metres a second (the stair clips' own paces, about). */
const PACES = [['walk', 0.65], ['jog', 2], ['run', 3.5]] as const;

// ---- the step's height is the controller's own ---------------------------------------------------------------------------
for (const f of ['src/player/player.ts', 'tools/swg/tests/grappleBody.ts']) {
  const text = readFileSync(join(REPO, f), 'utf8');
  const calls = [...text.matchAll(/enableAutostep\(([\d.]+),/g)].map((m) => Number(m[1]));
  ok(calls.length > 0 && calls.every((h) => h === STEP_HEIGHT), `${f}: every enableAutostep is the step's height (${calls.join(', ')} against ${STEP_HEIGHT})`);
}

/** A flight of `count` risers along +x from x 2, climbed (or gone down) with W held at `speed`: whether it got across, its longest stall, how long it took, and the step-up's counts. */
interface Climb { through: boolean; stall: number; time: number; at: number; steps: number; walls: number; trace: number[] }
async function climb(H: Harness, fps: number, riser: number, tread: number, speed: number, way = 1, count = 6, keep = false): Promise<Climb> {
  const p = await H.makePhysics();
  // (A riser of nought: the floor alone, the movement's own pace at the rate.)
  if (riser > 0) flight(p as never, { tread, riser, count, x0: 2, way });
  p.stepOnce();
  const b = new H.TestBody(p);
  b.jka.forceLevel = 0;
  b.forward.set(1, 0, 0);
  b.right.set(0, 0, 1);
  b.place(0.8, way > 0 ? 0.02 : count * riser + 0.02, 0);
  b.speedScale = speed / JKA_RUN;
  b.key('KeyW', true);
  const dt = 1 / fps;
  const end = 2 + count * tread + 1;
  let stall = 0;
  let worst = 0;
  let last = b.pos.x;
  let t = 0;
  let through = false;
  const trace: number[] = [];
  const most = Math.ceil(((end - 0.8) / speed) * 4 + 3) * fps;
  for (let i = 0; i < most; i++) {
    b.frame(dt);
    t += dt;
    if (keep) trace.push(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.grounded ? 1 : 0);
    if (b.pos.x - last < 0.05 * speed * dt) {
      stall += dt;
      if (stall > worst) worst = stall;
    } else stall = 0;
    last = b.pos.x;
    if (b.pos.x >= end) {
      through = true;
      break;
    }
  }
  const su = (b as unknown as { stepUp?: { steps: number; walls: number } }).stepUp;
  p.world.free();
  return { through, stall: worst, time: t, at: b.pos.x, steps: su ? su.steps : 0, walls: su ? su.walls : 0, trace };
}
const n2 = (v: number) => v.toFixed(2);

/**
 * One riser of `h` across the whole way (40 m either side), met with W held at `speed` from `deg` off square (the review of
 * Stairs II: risers taller than the step were climbed at an angle): whether the body got onto its top, and how high it got.
 */
async function wallAt(H: Harness, fps: number, h: number, speed: number, deg: number): Promise<{ top: boolean; most: number }> {
  const p = await H.makePhysics();
  // (A floor of triangles, as the game's own ground and buildings are: the harness's solid block ground lets the
  // controller's snap sink the capsule a third of a metre at 30 frames a second walking 45 degrees off its axes, under
  // either rule, which is the block's and not the step's.)
  H.box(p as never, [-60, -1, -60], [60, 0, 60]);
  H.box(p as never, [2, 0, -40], [12, h, 40]);
  p.stepOnce();
  const b = new H.TestBody(p);
  b.jka.forceLevel = 0;
  const a = (deg * Math.PI) / 180;
  b.forward.set(Math.cos(a), 0, Math.sin(a));
  b.right.set(-Math.sin(a), 0, Math.cos(a));
  b.place(0.8, 0.02, 0);
  b.speedScale = speed / JKA_RUN;
  b.key('KeyW', true);
  const dt = 1 / fps;
  let most = 0;
  const frames = Math.ceil((1.2 / (speed * Math.cos(a)) + 2) * fps);
  for (let i = 0; i < frames; i++) {
    b.frame(dt);
    if (b.pos.y > most) most = b.pos.y;
  }
  const top = b.pos.x > 2.1 && b.pos.y > h - 0.1;
  p.world.free();
  return { top, most };
}

// ---- under 'mended': climbed at every rate, and alike ----------------------------------------------------------------------
LOCO_TUNE.step.rule = 'mended';
const RISERS = [0.21, 0.32, 0.42, 0.48];
for (const riser of RISERS) {
  for (const [pace, speed] of PACES) {
    const runs: Climb[] = [];
    for (const fps of FPS) runs.push(await climb(Today, fps, riser, 0.315, speed));
    ok(runs.every((r) => r.through && r.stall < 0.1), `riser ${riser} m, ${pace} up: climbed at 30, 60, 144 and 240 frames a second, the longest stall ${runs.map((r) => n2(r.stall)).join(', ')} s`);
    // What the stairs cost over the floor alone at each rate (the movement's own pace parts by rate a little at 30).
    const flat: Climb[] = [];
    for (const fps of FPS) flat.push(await climb(Today, fps, 0, 0.315, speed));
    const cost = runs.map((r, i) => r.time - flat[i].time);
    ok(Math.max(...cost) - Math.min(...cost) <= Math.max(0.15, 0.03 * runs[1].time), `  and they cost about the same over the floor alone at every rate, to 0.15 s or 3% of the time across (${cost.map(n2).join(', ')} s; across in ${runs.map((r) => n2(r.time)).join(', ')} s)`);
    if (riser >= 0.42) note(`riser ${riser} m, ${pace}: the mend's own steps taken ${runs.map((r) => r.steps).join(', ')} at 30, 60, 144 and 240`);
  }
  const down = await Promise.all(FPS.map((fps) => climb(Today, fps, riser, 0.315, 0.65, -1)));
  ok(down.every((r) => r.through && r.stall < 0.1), `riser ${riser} m, walking down: across at every rate (${down.map((r) => n2(r.time)).join(', ')} s)`);
}
for (const riser of [0.52, 0.6]) {
  for (const [pace, speed] of PACES) {
    const runs: Climb[] = [];
    for (const fps of FPS) runs.push(await climb(Today, fps, riser, 0.315, speed));
    ok(runs.every((r) => !r.through && r.at < 2), `riser ${riser} m (over the step's ${STEP_HEIGHT}), ${pace}: a wall at 30, 60, 144 and 240 frames a second (stopped at x ${runs.map((r) => n2(r.at)).join(', ')}; the controller's own lift onto it undone ${runs.map((r) => r.walls).join(', ')} times)`);
  }
}
// The review of Stairs II: a riser over the step's height met at an angle was climbed (the floor read from feet perched up
// the face, the controller's own lift and its slope over the top edge left as they were). Met 30 and 60 degrees off square it
// is a wall too, and one within the step is still climbed there.
for (const h of [0.51, 0.6]) {
  for (const deg of [30, 60]) {
    for (const [pace, speed] of PACES) {
      const runs: { top: boolean; most: number }[] = [];
      for (const fps of FPS) runs.push(await wallAt(Today, fps, h, speed, deg));
      ok(runs.every((r) => !r.top && r.most < 0.15), `a ${h} m riser met ${deg} degrees off square, ${pace}: a wall at 30, 60, 144 and 240 frames a second (the body at most ${runs.map((r) => n2(r.most)).join(', ')} m up)`);
    }
  }
}
for (const deg of [30, 60]) {
  const runs: { top: boolean; most: number }[] = [];
  for (const fps of FPS) runs.push(await wallAt(Today, fps, 0.49, 0.65, deg));
  ok(runs.every((r) => r.top), `  and a 0.49 m riser met ${deg} degrees off square is walked up at every rate`);
}

// ---- under 'before': the faults --------------------------------------------------------------------------------------------
LOCO_TUNE.step.rule = 'before';
{
  const stalled = await climb(Today, 144, 0.32, 0.315, 0.65);
  ok(!stalled.through || stalled.stall > 1, `under 'before' (33d3e67's) a walk up 0.32 m risers at 144 frames a second stalls (${stalled.through ? `across in ${n2(stalled.time)} s with a stall of ${n2(stalled.stall)} s` : `stopped at x ${n2(stalled.at)}`}), so the check is not blind`);
  const at60 = await climb(Today, 60, 0.32, 0.315, 0.65);
  ok(at60.through && at60.stall < 0.1, `  and at 60, where every frame sees a physics step, it does not (${n2(at60.time)} s)`);
  const jog30 = await climb(Today, 30, 0.52, 0.315, 2);
  ok(jog30.through, `under 'before' a jog at 30 frames a second climbs 0.52 m risers (the engine's step reaches its height and its offset, 0.54 m), so the wall's check is not blind`);
  const walk42 = await climb(Today, 60, 0.42, 0.315, 0.65);
  ok(!walk42.through || walk42.stall > 1, `under 'before' a walk up 0.42 m risers at 60 frames a second stalls (the engine's step slides back off the nosing: ${walk42.through ? `${n2(walk42.stall)} s` : `stopped at x ${n2(walk42.at)}`})`);
}

// ---- day one ---------------------------------------------------------------------------------------------------------------
{
  /** The scenes under 'before': up 0.21 and 0.32 m risers at a walk, 0.52 m at a jog, down 0.32 m, at four rates. */
  const traceOf = async (H: Harness): Promise<string[]> => {
    const rows: string[] = [];
    for (const fps of FPS) {
      for (const [riser, speed, way] of [[0.21, 0.65, 1], [0.32, 0.65, 1], [0.52, 2, 1], [0.32, 0.65, -1]] as const) {
        const c = await climb(H, fps, riser, 0.315, speed, way, 4, true);
        for (let i = 0; i < c.trace.length; i += 7) rows.push(`${fps} ${riser} ${way} ${c.trace.slice(i, i + 7).map((v) => (Object.is(v, -0) ? '-0' : String(v))).join(' ')}`);
      }
    }
    return rows;
  };
  LOCO_TUNE.step.rule = 'before';
  const now = await traceOf(Today);
  LOCO_TUNE.step.rule = 'mended';
  const mended = await traceOf(Today);
  const digest = createHash('sha1').update(now.join('\n')).digest('hex').slice(0, 16);
  const first = mended.findIndex((r, i) => r !== now[i]);
  ok(first >= 0, `under 'mended' the same scenes change (from row ${first}: ${mended[first]?.split(' ').slice(0, 3).join(' ')}), so the check is not blind`);
  const old = await loadOldMany(['tools/swg/tests/grappleBody.ts'], ['tools/swg/tests/grappleBody.ts'], PRE_WAVE);
  if (old) {
    LOCO_TUNE.step.rule = 'before';
    const then = await traceOf(old[0] as unknown as Harness);
    LOCO_TUNE.step.rule = 'mended';
    const at = now.findIndex((r, i) => r !== then[i]);
    ok(now.length === then.length && at < 0, `day one: under step.rule 'before' the body is ${PRE_WAVE}'s own up and down stairs, frame for frame at 30, 60, 144 and 240 frames a second (${now.length} rows, every number by Object.is)${at >= 0 ? `: row ${at} is ${now[at]} against ${then[at]}` : ''}`);
    note(`the body's trace digest is ${digest} (BODY_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s harness here: the body's trace is held to the digest recorded from it`);
  ok(digest === BODY_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own harness (${digest})`);
}

// ---- mutations -------------------------------------------------------------------------------------------------------------
{
  const FILES = ['tools/swg/tests/grappleBody.ts', 'src/player/stepUp.ts'];
  const mutant = async (from: string, to: string): Promise<Harness> => {
    const t = new Map<string, string>();
    for (const f of FILES) t.set(f, readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n'));
    const src = t.get('src/player/stepUp.ts')!;
    assert.ok(src.includes(from), `a mutation found nothing to change: ${from}`);
    t.set('src/player/stepUp.ts', src.replace(from, to));
    return (await loadTexts(t, ['tools/swg/tests/grappleBody.ts']))[0] as unknown as Harness;
  };
  LOCO_TUNE.step.rule = 'mended';
  const noSync = await mutant("if (LOCO_TUNE.step.rule !== 'mended' || !a.ruled) return;\n    const p = this.put;", "return;\n    const p = this.put;");
  // (The cast step alone climbs most of it: what the collider a frame or two behind the body still costs is stalls on the
  // tallest risers at 144 and 240 frames a second, and a body stuck for good on a long flight's way down at 240.)
  const s = await climb(noSync, 144, 0.48, 0.315, 0.65);
  const d = await climb(noSync, 240, 0.42, 0.79, 2, -1);
  ok((!s.through || s.stall >= 0.1) && (!d.through || d.stall >= 0.5), `mutation: the collider not put where the body is: a walk up 0.48 m risers at 144 frames a second stalls again (${s.through ? `${n2(s.stall)} s` : `stopped at x ${n2(s.at)}`}), and a jog down 0.42 m risers on 0.79 m treads at 240 sticks (${d.through ? `${n2(d.stall)} s` : `stopped at x ${n2(d.at)}`})`);
  const noStep = await mutant('    mv.x = ux * across;\n    mv.y = up - downHit.time_of_impact;\n    mv.z = uz * across;\n    this.took = true;', '    this.took = false;');
  const k = await climb(noStep, 60, 0.48, 0.315, 0.65);
  ok(!k.through || k.stall > 0.5, `mutation: no step taken: a walk up 0.48 m risers at 60 frames a second stalls (${k.through ? `${n2(k.stall)} s` : `stopped at x ${n2(k.at)}`})`);
  const noWall = await mutant('    if (!collider) return;\n    const mh = controller.autostepMaxHeight();', '    return;\n    const mh = controller.autostepMaxHeight();');
  const w = await climb(noWall, 30, 0.52, 0.315, 2);
  ok(w.through, 'mutation: the controller\'s lift onto a riser taller than the step not undone: a jog at 30 frames a second climbs 0.52 m again');
  // The review of Stairs II: a riser over the step's height met at an angle was climbed. Each part of what mends it, undone.
  // (The rise held down where a lift is undone, `unlift`'s `keep`, is not mutated here: with the lift looked for, no scene of
  // this harness's climbs without it; it was the last of the angle's three holes, measured before the lift was looked for.)
  const noLift = await mutant('      if (lifted && face < 0 && c.witness1.y > liftY) {', '      if (false) {');
  const lw: string[] = [];
  let lifted = false;
  for (const fps of FPS) {
    for (const deg of [30, 60]) {
      for (const [, speed] of PACES) {
        const r = await wallAt(noLift, fps, 0.51, speed, deg);
        if (r.top) {
          lifted = true;
          lw.push(`${fps} fps ${deg} degrees at ${speed} m/s`);
        }
      }
    }
  }
  ok(lifted, `mutation: the controller's own lift not looked for: a 0.51 m riser met at an angle is climbed again (${lw.slice(0, 4).join('; ')})`);
  const noReach = await mutant('if (world.castShape(f, this.rot, d, shape, 0, a.off + STEP_HEIGHT, false, undefined, a.filter, collider, body, pass) === null) a.ruled = false;', 'a.ruled = false;');
  const rflat = await climb(noReach, 240, 0, 0.315, 0.65);
  const rup = await climb(noReach, 240, 0.48, 0.315, 0.65);
  const rflat60 = await climb(noReach, 60, 0, 0.315, 0.65);
  const rup60 = await climb(noReach, 60, 0.48, 0.315, 0.65);
  ok(Math.abs(rup.time - rflat.time - (rup60.time - rflat60.time)) > 0.15, `mutation: no floor looked for where the slope rule found none: a walk up 0.48 m risers costs other than it does at 60 at 240 frames a second again (${n2(rup.time - rflat.time)} against ${n2(rup60.time - rflat60.time)} s)`);
  const tall = await mutant('export const STEP_HEIGHT = 0.5;', 'export const STEP_HEIGHT = 0.6;');
  const t = await climb(tall, 60, 0.52, 0.315, 0.65);
  ok(t.through, 'mutation: a step of 0.6 m: a walk climbs 0.52 m risers (so the wall is the step\'s height and nothing else)');
}

LOCO_TUNE.step.rule = 'mended';
console.log(`playerStepUp: ${checks} checks passed`);
