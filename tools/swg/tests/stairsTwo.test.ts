// Stairs II, items B to D, through the stairs wave's walker (`stairsWaveBody.ts`: the game's classes, the stairs' sampler,
// the feet and the clips over the real Rapier and the player's own movement), at 30, 60, 144 and 240 frames a second:
//  - B, the stair clips only on stairs: a riser over `riserMax` (0.422 m) or a tread over `treadMax` (0.79 m) is no stair,
//    and the walk plays over it; the testbeds within them are read as stairs over the whole flight;
//  - C, the clip ends at the last step: given back to the walk at the footfall past the last riser (the stairs held only
//    while a riser of their way stands ahead within `treadMax`), the foot that ends it on the floor beyond, where 33d3e67's
//    held it on 1.3 m; and taken on `takeOn` before a flight's first riser, a landing longer than a tread included, with no
//    planted foot sliding on it;
//  - D, going down the whole body is mirrored by default (`stairs.mirror` 'whole'), the legs alone under 'legs';
//  - day one: with every Stairs II switch and dial at 33d3e67's (`stairs.hold`, `riserMax`, `treadMax`, `look`, `mirror`,
//    `step.rule`) the walker is 33d3e67's own, frame for frame at 30, 60, 144 and 240 frames a second (that commit's
//    modules out of git; a recorded digest where git cannot answer);
//  - mutations of each new rule, each failing.
//
// Run: node tools/swg/tests/stairsTwo.test.ts (SWG3JS_NO_OLD=1 holds day one to the recorded digest alone)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as H from './grappleBody.ts';
import * as Today from './stairsWaveBody.ts';
import { LOCO_TUNE, LOCO_TUNE_SHIPPED } from '../../../src/anim/locoTune.ts';
import { REPO, loadOldMany, loadTexts } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const PRE_WAVE = '33d3e67';
/** The digest of the day-one traces under 33d3e67's own walker (what a checkout with no history is held to). */
const WALK_TRACE = '92325a5f253b3b3c';
type WaveBody = typeof import('./stairsWaveBody.ts');
const FPS = [30, 60, 144, 240] as const;
const R0 = 0.2108;
const T0 = 0.315;
const COUNT = 12;

/** Stairs II's switches and dials at 33d3e67's, or (null) at their shipped values. */
function twoAt(before: boolean): void {
  const s = LOCO_TUNE_SHIPPED.stairs;
  LOCO_TUNE.step.rule = before ? 'before' : LOCO_TUNE_SHIPPED.step.rule;
  LOCO_TUNE.stairs.hold = before ? 'before' : s.hold;
  LOCO_TUNE.stairs.riserMax = before ? 0.5 : s.riserMax;
  LOCO_TUNE.stairs.treadMax = before ? 4 : s.treadMax;
  LOCO_TUNE.stairs.look = before ? 1.6 : s.look;
  LOCO_TUNE.stairs.mirror = before ? 'legs' : s.mirror;
  LOCO_TUNE.stairs.takeOn = s.takeOn;
}

interface Bed { tread: number; riser: number; landing?: number }
interface Walked {
  through: boolean;
  stall: number;
  /** The share of the flight's frames the sampler read as stairs. */
  read: number;
  /** How far past the last riser the stair clip played, metres. */
  past: number;
  /** How far before the first riser it was taken on, metres (NaN never). */
  on: number;
  /** The footfall nearest the hand-over to the walk past the flight: where it came down past the last riser (metres; NaN none). */
  handFoot: number;
  /** The worst slide of a planted foot along the ground over one stance, metres. */
  slide: number;
  /** How many times the stair clip was given back to the regular one before the last riser (on a landing, or a flicker). */
  gaveWay: number;
  stairClips: Set<string>;
  rows: string[];
}
async function walkBed(W: WaveBody, made: Awaited<ReturnType<WaveBody['clipsAndCycles']>>, bed: Bed, fps: number, pace: 'walk' | 'jog' | 'run', way: number, keep = false): Promise<Walked> {
  const p = await H.makePhysics();
  const x0 = 2;
  const half = bed.landing ? 6 : 0;
  const prof = W.flight(p as never, { tread: bed.tread, riser: bed.riser, count: COUNT, x0, way, half, landing: bed.landing ? bed.landing / bed.tread : 0 });
  p.stepOnce();
  const w = new W.Walker(p as never, made.clips, made.cycles);
  w.walk = pace === 'walk';
  w.run = pace === 'run';
  w.place(0, way > 0 ? 0.02 : COUNT * bed.riser + 0.02, 0);
  let lastRiser = x0;
  {
    let x = x0;
    for (let i = 0; i < COUNT; i++) {
      lastRiser = x;
      x += half > 0 && i === half ? bed.landing! : bed.tread;
    }
  }
  const end = lastRiser + 3;
  const dt = 1 / fps;
  const out: Walked = { through: false, stall: 0, read: 0, past: 0, on: Number.NaN, handFoot: Number.NaN, slide: 0, gaveWay: 0, stairClips: new Set(), rows: [] };
  let stall = 0;
  let lastX = 0;
  let onFlight = 0;
  let onStairs = 0;
  let wasStair = false;
  let tNow = 0;
  let handAt = Number.NaN;
  const falls: number[] = [];
  const was = [0, 0];
  const st: (number[] | null)[] = [null, null];
  for (let i = 0; i < 40 * fps; i++) {
    const r = w.frame(dt);
    tNow += dt;
    if (keep) out.rows.push(`${fps} ${r.x} ${r.y} ${r.clip} ${r.way} ${r.known} ${r.hipY} ${r.legs.map((l) => `${l.planted} ${l.heel.join(' ')} ${l.ball.join(' ')}`).join(' ')}`);
    const moved = r.x - lastX;
    lastX = r.x;
    if (moved < 0.0005 * (60 / fps)) {
      stall += dt;
      if (stall > out.stall) out.stall = stall;
    } else stall = 0;
    if (r.x > x0 + 0.2 && r.x < lastRiser - 0.2) {
      onFlight++;
      if (r.way !== 0) onStairs++;
    }
    const stair = /stair/i.test(r.clip);
    if (stair) out.stairClips.add(r.clip);
    if (r.x >= lastRiser && stair) out.past = Math.max(out.past, r.x - lastRiser);
    if (out.on !== out.on && stair) out.on = x0 - r.x;
    if (wasStair && !stair && r.x > lastRiser - 0.5 && handAt !== handAt) handAt = tNow;
    if (wasStair && !stair && r.x < lastRiser - 0.1) out.gaveWay++;
    wasStair = stair;
    // Each footfall (a foot's weight crossing a half), its time and where it came down.
    for (let s = 0; s < 2; s++) {
      const l = r.legs[s];
      if (l.planted >= 0.5 && was[s] < 0.5) falls.push(tNow, (l.heel[0] + l.ball[0]) / 2);
      was[s] = l.planted;
    }
    for (let s = 0; s < 2; s++) {
      const l = r.legs[s];
      if (l.planted >= 0.99 && l.grounded) {
        const q = st[s] ?? (st[s] = [Infinity, -Infinity, Infinity, -Infinity]);
        if (Math.abs(l.heel[1] - prof(l.heel[0])) <= 0.01) {
          q[0] = Math.min(q[0], l.heel[0]);
          q[1] = Math.max(q[1], l.heel[0]);
        }
        if (Math.abs(l.ball[1] - prof(l.ball[0])) <= 0.01) {
          q[2] = Math.min(q[2], l.ball[0]);
          q[3] = Math.max(q[3], l.ball[0]);
        }
      } else if (st[s]) {
        const q = st[s]!;
        out.slide = Math.max(out.slide, q[1] > q[0] ? q[1] - q[0] : 0, q[3] > q[2] ? q[3] - q[2] : 0);
        st[s] = null;
      }
    }
    if (r.x >= end) {
      out.through = true;
      break;
    }
  }
  out.read = onFlight ? onStairs / onFlight : 0;
  // The footfall that ended the stairs: the one nearest the hand-over, within 0.3 s of it (the feet's weight crosses a half
  // a frame or two from the clip's own mark).
  let best = 0.3;
  for (let k = 0; k < falls.length; k += 2) {
    const d = Math.abs(falls[k] - handAt);
    if (d <= best) {
      best = d;
      out.handFoot = falls[k + 1] - lastRiser;
    }
  }
  p.world.free();
  return out;
}
const n2 = (v: number) => v.toFixed(2);
const made = await Today.clipsAndCycles();

// ---- the testbeds under the shipped tune ----------------------------------------------------------------------------------
twoAt(false);
const BEDS: [string, Bed][] = [
  ['base', { tread: T0, riser: R0 }],
  ['risers twice', { tread: T0, riser: 2 * R0 }],
  ['treads 2.5 times', { tread: 2.5 * T0, riser: R0 }],
  ['both at their most', { tread: 2.5 * T0, riser: 2 * R0 }],
  ['stadium', { tread: 0.48, riser: 0.32 }],
  ['a 1 m landing', { tread: T0, riser: R0, landing: 1 }],
];
for (const [name, bed] of BEDS) {
  for (const way of [1, -1]) {
    for (const pace of ['walk', 'run'] as const) {
      const runs: Walked[] = [];
      for (const fps of FPS) runs.push(await walkBed(Today, made, bed, fps, pace, way));
      const tag = `${name} (${bed.riser.toFixed(3)}/${bed.tread.toFixed(3)}${bed.landing ? `, a landing of ${bed.landing} m halfway` : ''}), ${pace} ${way > 0 ? 'up' : 'down'}`;
      ok(runs.every((r) => r.through && r.stall < 0.1), `${tag}: across at 30, 60, 144 and 240 frames a second, the longest stall ${runs.map((r) => n2(r.stall)).join(', ')} s`);
      ok(runs.every((r) => r.read >= 0.95), `  read as stairs over the flight (${runs.map((r) => `${Math.round(r.read * 100)}%`).join(', ')})`);
      // (Given back at the second footfall past the last riser's reach, the review of Stairs II's rule: alike at every rate,
      // under half 33d3e67's 1.3 m at a walk and three quarters of it at a run, whose stride is the longer.)
      const pastMost = pace === 'walk' ? 0.65 : 1;
      ok(runs.every((r) => r.past < pastMost && r.on === r.on && r.on >= 0.05 && r.on <= 0.8), `  the stair clip taken on ${runs.map((r) => n2(r.on)).join(', ')} m before the first riser and given back ${runs.map((r) => n2(r.past)).join(', ')} m past the last (33d3e67: about 0.4 and 1.3)`);
      const pasts = runs.map((r) => r.past);
      if (bed.landing) ok(runs.every((r) => r.gaveWay === runs[0].gaveWay), `  the landing is walked the same way at every rate (the stair clip given way on it ${runs.map((r) => r.gaveWay).join(', ')} times; the review of Stairs II: at a run it flickered to the run and back at 30 and 60 frames a second and not at 144)`);
      // (To 0.15 m: the clip is chosen before the frame's step and the footfall that ends it is found in the step, so it is
      // given back a frame after, a frame's travel further along at 30 frames a second than at 240: 0.12 m at a run.)
      ok(Math.max(...pasts) - Math.min(...pasts) <= 0.15, `  and given back at the same place at every rate, to 0.15 m (${pasts.map(n2).join(', ')} m; the review of Stairs II: it gave way rate by rate)`);
      ok(runs.every((r) => r.handFoot === r.handFoot && r.handFoot > 0), `  handed back at a footfall on the floor past the last riser (${runs.map((r) => n2(r.handFoot)).join(', ')} m past it)`);
    }
  }
}

// ---- B: what is no stair --------------------------------------------------------------------------------------------------
for (const [name, bed] of [['treads three times (0.945 m, over treadMax)', { tread: 3 * T0, riser: R0 }], ['risers of 0.48 m (over riserMax)', { tread: T0, riser: 0.48 }]] as [string, Bed][]) {
  for (const way of [1, -1]) {
    const runs: Walked[] = [];
    for (const fps of FPS) runs.push(await walkBed(Today, made, bed, fps, 'walk', way));
    ok(runs.every((r) => r.through && r.read === 0 && r.stairClips.size === 0), `${name}, walking ${way > 0 ? 'up' : 'down'}: across at every rate, never read as stairs and no stair clip played (stalls ${runs.map((r) => n2(r.stall)).join(', ')} s)`);
  }
}

// ---- C: a landing longer than a tread, taken on again before the next riser -------------------------------------------------
{
  const landing = { tread: 0.28, riser: 0.17, landing: 0.84 };
  const runs: Walked[] = [];
  for (const fps of FPS) runs.push(await walkBed(Today, made, landing, fps, 'walk', 1));
  // (The walk's first stance after a hand-over slides 3 to 5 cm, on the landing and on the top floor alike: stairStep.test.ts.)
  ok(runs.every((r) => r.through && r.slide < 0.06), `a landing of 0.84 m (three 0.28 m treads, longer than treadMax) walking up: the walk on the landing between two flights, no planted foot sliding 6 cm or more at any rate (worst ${runs.map((r) => `${Math.round(r.slide * 1000)}`).join(', ')} mm)`);
}

// ---- D: the mirror going down ---------------------------------------------------------------------------------------------
{
  const whole = await walkBed(Today, made, { tread: T0, riser: R0 }, 60, 'walk', -1);
  ok(LOCO_TUNE_SHIPPED.stairs.mirror === 'whole' && [...whole.stairClips].every((c) => /~whole$/.test(c)) && whole.stairClips.size > 0, `going down by default the stair clip is the whole body's mirrored cycle (${[...whole.stairClips].join(', ')})`);
  LOCO_TUNE.stairs.mirror = 'legs';
  const legs = await walkBed(Today, made, { tread: T0, riser: R0 }, 60, 'walk', -1);
  ok([...legs.stairClips].some((c) => /~legs$/.test(c)), `  and under 'legs' the legs' alone (${[...legs.stairClips].join(', ')})`);
  twoAt(false);
}

// ---- day one ---------------------------------------------------------------------------------------------------------------
{
  const traceOf = async (W: WaveBody): Promise<string[]> => {
    const m = await W.clipsAndCycles();
    const rows: string[] = [];
    for (const fps of FPS) for (const way of [1, -1]) for (const pace of ['walk', 'jog'] as const) rows.push(...(await walkBed(W, m, { tread: T0, riser: R0, landing: 1 }, fps, pace, way, true)).rows);
    return rows;
  };
  twoAt(true);
  const now = await traceOf(Today);
  twoAt(false);
  const shipped = await traceOf(Today);
  const digest = createHash('sha1').update(now.join('\n')).digest('hex').slice(0, 16);
  const first = shipped.findIndex((r, i) => r !== now[i]);
  ok(first >= 0, `under the shipped tune the same walks change (from row ${first}), so the check is not blind`);
  const FILES = ['tools/swg/tests/stairsWaveBody.ts', 'tools/swg/tests/grappleBody.ts', 'src/anim/bodyLoco.ts', 'src/anim/stairsRule.ts', 'src/player/stairSense.ts', 'src/anim/locoTune.ts'];
  const old = await loadOldMany(FILES, ['tools/swg/tests/stairsWaveBody.ts'], PRE_WAVE);
  if (old) {
    const then = await traceOf(old[0] as unknown as WaveBody);
    const at = now.findIndex((r, i) => r !== then[i]);
    ok(now.length === then.length && at < 0, `day one: with Stairs II's switches and dials at ${PRE_WAVE}'s the walker is ${PRE_WAVE}'s own up and down a flight with a landing, walking and jogging (33d3e67's walker has no run), frame for frame at 30, 60, 144 and 240 frames a second (${now.length} rows: the place, the clip, the stairs read, the hips, the feet, by Object.is)${at >= 0 ? `: row ${at} is ${now[at].slice(0, 160)} against ${then[at].slice(0, 160)}` : ''}`);
    note(`the walker's trace digest is ${digest} (WALK_TRACE)`);
  } else note(`git cannot hand over ${PRE_WAVE}'s walker here: its trace is held to the digest recorded from it`);
  ok(digest === WALK_TRACE, `and its digest is the one recorded from ${PRE_WAVE}'s own modules (${digest})`);
}

// ---- mutations -------------------------------------------------------------------------------------------------------------
{
  const FILES = ['tools/swg/tests/stairsWaveBody.ts', 'src/anim/bodyLoco.ts', 'src/anim/stairsRule.ts', 'src/player/stairSense.ts'];
  const mutant = async (file: string, from: string, to: string): Promise<WaveBody> => {
    const t = new Map<string, string>();
    for (const f of FILES) t.set(f, readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n'));
    const src = t.get(file)!;
    assert.ok(src.includes(from), `a mutation found nothing to change in ${file}: ${from}`);
    t.set(file, src.replace(from, to));
    return (await loadTexts(t, ['tools/swg/tests/stairsWaveBody.ts']))[0] as unknown as WaveBody;
  };
  twoAt(false);
  const base = { tread: T0, riser: R0 };
  const noEnd = await mutant('src/anim/stairsRule.ts', '    return !this.landed;\n  }', '    return true;\n  }');
  const e = await walkBed(noEnd, made, base, 60, 'walk', 1);
  ok(e.past >= 0.65, `mutation: the stair clip not given back at the footfall once the hold is ending: it plays ${n2(e.past)} m past the last riser`);
  const noTreadMax = await mutant('src/anim/stairsRule.ts', 'tread >= tune.treadMin && tread <= longest', 'tread >= tune.treadMin');
  const t3 = await walkBed(noTreadMax, made, { tread: 3 * T0, riser: R0 }, 60, 'walk', 1);
  ok(t3.read > 0 || t3.stairClips.size > 0, `mutation: the longest tread not asked: treads of 0.945 m are stairs again (read ${Math.round(t3.read * 100)}%)`);
  const noTakeOn = await mutant('src/anim/stairsRule.ts', 'fAhead <= (fGap > tune.takeOn ? fGap : tune.takeOn) + slack', 'fAhead <= fGap + slack');
  // (At every rate. The hand-over's own look a footfall ahead now keeps the clip on such a landing's far end as well, so what
  // the hold's take-on adds is smaller than it was: 60 to 68 mm against the shipped 33 to 47.)
  const ls: number[] = [];
  for (const fps of FPS) ls.push((await walkBed(noTakeOn, made, { tread: 0.28, riser: 0.17, landing: 0.84 }, fps, 'walk', 1)).slide);
  ok(Math.min(...ls) >= 0.055, `mutation: taken on only within one of the flight's own treads: on the 0.84 m landing a planted walking foot slides ${ls.map((s) => Math.round(s * 1000)).join(', ')} mm as the body meets the next riser (under 50 mm as shipped, above)`);
  const noAhead = await mutant('src/anim/stairsRule.ts', '        const next = (over ? r1 + q.gap : r1) - (q.rate > 0 && steps > 0 ? (q.speed * len) / steps / q.rate : 0);', '        const next = over ? r1 + q.gap : r1;');
  const gw: number[] = [];
  for (const fps of FPS) gw.push((await walkBed(noAhead, made, { tread: T0, riser: R0, landing: 1 }, fps, 'run', 1)).gaveWay);
  ok(gw.some((g) => g !== gw[0]), `mutation: the hand-over not looking a footfall ahead for the next flight: a run over a 1 m landing gives way on it at some rates and not others again (${gw.join(', ')})`);
  const noHand = await mutant('src/anim/bodyLoco.ts', 'const stairsNow = this.stairEnd.plays(f.stairs, f.stairEnding) ? f.stairs : 0;', 'const stairsNow = f.stairs;');
  const h = await walkBed(noHand, made, base, 60, 'walk', 1);
  ok(h.past >= 0.65, `mutation: the classes not told the hold is ending: the stair clip plays ${n2(h.past)} m past the last riser`);
}

twoAt(false);
console.log(`stairsTwo: ${checks} checks passed`);
