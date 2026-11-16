// The stairs wave, part C: one step a stair (`src/anim/stairStep.ts`), its rules on their own and then the human male walked
// up and down real flights by the game's own movement, classes, sampler, cycles and feet (`stairsWaveBody.ts`, the player's
// order):
//  - n: under 'auto' the n whose treads and risers are nearest the clip's own step, one more for a running clip outrunning
//    the band, held on a flight and chosen again for another tread; forced n; `nMost`;
//  - the speed: the clip's own pace eased toward the class's by `pace`, held to the rate band; the stride n treads over the
//    clip's step;
//  - the rate: the distance gone at the clip's seconds a metre, each footfall steered onto `land` of a tread however
//    unevenly the body moves (and without the steering it would not land there), a clip taken on started at the phase that
//    lands its next footfall so;
//  - the walker over four flights, walking up and down at 60 frames a second, one at 30 and 144, a flight with a landing
//    halfway and the flight's end: every planted foot on a tread and not over a nosing, no planted foot sliding more than
//    2 cm, a footfall every n treads; the flight's ends walked onto and off at 60 and 144 (none over a nosing, none sliding
//    more than 3 cm); running up and down, every footfall n treads on from the last, the rest measured and said.
//
// Run: node tools/swg/tests/stairStep.test.ts
import assert from 'node:assert/strict';
import { StairStep, StairStepIn } from '../../../src/anim/stairStep.ts';
import { LOCO_TUNE_SHIPPED, type LocoTune } from '../../../src/anim/locoTune.ts';
import type { StairCycleFacts } from '../../../src/anim/stairCycle.ts';
import * as H from './grappleBody.ts';
import * as W from './stairsWaveBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const tuneOf = (): LocoTune['stairs'] => (JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune).stairs;
const factsOf = (o: Partial<{ len: number; at: number[]; off: number[]; mid: number[]; fwd: number; rise: number; run: boolean }> = {}): StairCycleFacts =>
  ({ name: 'test', len: o.len ?? 1.2, steps: 2, at: new Float64Array(o.at ?? [0.2, 0.8]), side: new Int8Array([0, 1]), off: new Float64Array(o.off ?? [0.2, 0.2]), mid: new Float64Array(o.mid ?? [0.08, 0.08]), run: o.run ?? false, fwd: o.fwd ?? 0.26, rise: o.rise ?? 0.2, seam: 0, seamVel: 1 }) as unknown as StairCycleFacts;
const inOf = (o: Partial<StairStepIn>): StairStepIn => Object.assign(new StairStepIn(), { dt: 1 / 60, known: true, way: 1, tread: 0.28, riser: 0.17, next: 0.1, asked: 0.8, scale: 1, moved: 0, time: Number.NaN }, o);

// ---- n -------------------------------------------------------------------------------------------------------------------------
{
  const t = tuneOf();
  const f = factsOf();
  const s = new StairStep();
  s.plan(inOf({}), f, t);
  ok(s.n === 1, `auto: a clip stepping 0.26 m and 0.20 m takes one 0.28/0.17 stair a step (n ${s.n})`);
  const s2 = new StairStep();
  s2.plan(inOf({ tread: 0.14, riser: 0.09 }), f, t);
  ok(s2.n === 2, `auto: and two 0.14/0.09 stairs a step (n ${s2.n})`);
  const t1 = tuneOf();
  t1.nMost = 1;
  const s3 = new StairStep();
  s3.plan(inOf({ tread: 0.14, riser: 0.09 }), f, t1);
  ok(s3.n === 1, `auto never takes more than nMost (1: n ${s3.n})`);
  for (const rule of ['1', '2', '3'] as const) {
    const tf = tuneOf();
    tf.perStep = rule;
    const sf = new StairStep();
    sf.plan(inOf({}), f, tf);
    ok(sf.n === Number(rule), `perStep '${rule}' forces ${rule} (n ${sf.n})`);
  }
  // Running: one more while the clip would outrun the band's top at this n and the next would not fall under its foot.
  const fr = factsOf({ run: true, len: 0.6, fwd: 0.226, rise: 0.195 });
  const sr = new StairStep();
  sr.plan(inOf({ asked: 4 }), fr, t);
  ok(sr.n === 2, `a running clip asked 4 m/s up 0.28/0.17 stairs takes two a step (n ${sr.n}: at one its rate would pass upAt)`);
  const sw = new StairStep();
  sw.plan(inOf({ asked: 4 }), factsOf({ len: 0.6, fwd: 0.226, rise: 0.195 }), t);
  ok(sw.n === 1, `and a walking clip asked the same keeps one (its speed is held to the band instead: n ${sw.n})`);
  // Held on a flight: the speed asked moving changes nothing; a tread past `resize` chooses again.
  sr.plan(inOf({ asked: 1 }), fr, t);
  ok(sr.n === 2, `n is held on the same flight however the speed asked moves (n ${sr.n})`);
  sr.plan(inOf({ asked: 1, tread: 0.4, riser: 0.2 }), fr, t);
  ok(sr.n === 1, `and chosen again for stairs past resize (a 0.40 tread: n ${sr.n})`);
  sr.reset();
  sr.plan(inOf({ asked: 4 }), fr, t);
  ok(sr.n === 2, `and afresh after a reset (n ${sr.n})`);
}

// ---- the speed and the stride -----------------------------------------------------------------------------------------------------
{
  const f = factsOf();
  const own = (1 * 0.28 * 2) / 1.2;
  for (const pace of [0, 0.25, 1]) {
    const t = tuneOf();
    t.pace = pace;
    const s = new StairStep();
    for (const asked of [0.2, 0.5, 2]) {
      s.plan(inOf({ asked }), f, t);
      const want = Math.min(t.rateHigh * own, Math.max(t.rateLow * own, own + pace * (asked - own)));
      ok(Math.abs(s.speed - want) < 1e-12 && Math.abs(s.own - own) < 1e-12, `pace ${pace}, asked ${asked} m/s: the speed is the clip's own pace ${own.toFixed(3)} eased by the share and held to the band (${s.speed.toFixed(3)})`);
    }
  }
  const s = new StairStep();
  const t = tuneOf();
  s.plan(inOf({ tread: 0.14, riser: 0.09 }), f, t);
  ok(Math.abs(s.stride - (2 * 0.14) / 0.26) < 1e-12, `the stride is n treads over the clip's own step (${s.stride.toFixed(3)})`);
  s.reset();
  s.plan(inOf({ tread: 0.6, riser: 0.2, scale: 1 }), factsOf({ fwd: 0.1 }), t);
  ok(s.stride === 3, `and held to three at the most (${s.stride})`);
  s.reset();
  s.plan(inOf({ known: false }), f, t);
  ok(s.n === 1 && Math.abs(s.stride - 1) < 1e-12, `with the stairs not measured the clip's own step is the tread: n 1 and the stride whole`);
}

// ---- the rate and the steering --------------------------------------------------------------------------------------------------
{
  const t = tuneOf();
  const f = factsOf();
  const s = new StairStep();
  const c = 1.2 / 2 / 0.28;
  s.plan(inOf({}), f, t);
  s.step(inOf({ time: 0.5, next: Number.NaN, moved: 0.01 }), f, t);
  ok(Math.abs(s.rate - (0.01 * c) / (1 / 60)) < 1e-9, `with no next riser the rate is the distance gone at the clip's seconds a metre (${s.rate.toFixed(3)})`);
  // A clip just taken on: started at the phase that lands its next footfall on its spot.
  s.step(inOf({ time: Number.NaN, next: 0.13, moved: 0 }), f, t);
  ok(s.snap === s.snap && s.snap >= 0 && s.snap < f.len, `a clip just taken on is started at a phase (${s.snap.toFixed(3)} s)`);
  s.step(inOf({ time: s.snap, next: 0.13, moved: 0 }), f, t);
  ok(Math.abs(s.miss) < 1e-9, `which lands its next footfall on its spot (it would miss by ${(s.miss * 1000).toFixed(3)} mm)`);
  // A body moving unevenly up a flight: each footfall lands `land` of the way along a tread.
  const walk = (steer: boolean, fps: number) => {
    const st = new StairStep();
    const T = 0.28;
    let x = 0.05;
    let time = Number.NaN;
    const landings: number[] = [];
    for (let i = 0; i < 6 * fps; i++) {
      const dt = 1 / fps;
      const v = 0.6 * (1 + 0.45 * Math.sin(i * dt * 7.3));
      const moved = v * dt;
      const xWas = x;
      x += moved;
      const next = T - (x % T);
      const fin = inOf({ dt, moved, time, next: steer ? next : Number.NaN });
      st.plan(fin, f, t);
      st.step(fin, f, t);
      if (st.snap === st.snap) time = st.snap;
      else if (time !== time) time = 0;
      const was = time;
      time += st.rate * dt;
      for (let k = 0; k < 2; k++) {
        let a = f.at[k] - was;
        a -= Math.floor(a / f.len) * f.len;
        // Where the body stood at the footfall's own moment inside the frame.
        // (The stride moves each foot about the middle of its own stance: it lands half the stride's gain on a step ahead of the clip's place.)
        if (a > 0 && a <= time - was) landings.push(xWas + (moved * a) / (time - was) + (f.off[k] + (st.stride - 1) * f.fwd * 0.5 + f.mid[k]));
      }
      time %= f.len;
    }
    return landings.map((l) => Math.abs(((l % T) + T) % T - t.land * T));
  };
  for (const fps of [30, 60, 144]) {
    const err = walk(true, fps);
    const worst = Math.max(...err.slice(2));
    ok(err.length > 10 && worst < 0.001, `steered at ${fps} frames a second, a body whose speed swings by 45% lands every footfall within ${(worst * 1000).toFixed(1)} mm of the middle of its tread (${err.length} footfalls)`);
  }
  const free = walk(false, 60);
  const worstFree = Math.max(...free.slice(2));
  ok(worstFree > 0.01, `mutation: without the steering the same body lands its feet up to ${(worstFree * 1000).toFixed(0)} mm off the middle`);
}

// ---- the walker over real flights -------------------------------------------------------------------------------------------------
const { clips, cycles } = await W.clipsAndCycles();
interface Run { n: number; planted: number; off: number; worst: number; over: number; falls: number; crossed: number; stances: number; slides: number; slide: number; speed: number; asked: number; rate: number; bad: number; knownOff: boolean; strideAfter: number; gaps: number[] }
async function walkFlight(tread: number, riser: number, way: number, gait: 'walk' | 'run', fps: number, opt: { half?: number; landing?: number; pin?: 'sole' | 'off'; before?: boolean; whole?: boolean; twoBefore?: boolean; far?: boolean } = {}): Promise<Run> {
  const count = 12;
  const p = await H.makePhysics();
  const prof = W.flight(p, { tread, riser, count, x0: 2, way, half: opt.half, landing: opt.landing });
  p.stepOnce();
  const LT = (await import('../../../src/anim/locoTune.ts')).LOCO_TUNE;
  const was0 = [LT.stairs.pin, LT.ik.hips, LT.stairs.cycle, LT.stairs.stepRule] as const;
  // Stairs II's switches and dials, at 33d3e67's with `twoBefore`.
  const two0 = [LT.step.rule, LT.stairs.hold, LT.stairs.riserMax, LT.stairs.treadMax, LT.stairs.look, LT.stairs.mirror] as const;
  if (opt.twoBefore) {
    LT.step.rule = 'before';
    LT.stairs.hold = 'before';
    LT.stairs.riserMax = 0.5;
    LT.stairs.treadMax = 4;
    LT.stairs.look = 1.6;
    LT.stairs.mirror = 'legs';
  }
  LT.stairs.pin = opt.pin ?? 'sole';
  if (opt.before) {
    LT.stairs.pin = 'off';
    LT.ik.hips = 'before';
    LT.stairs.cycle = 'before';
    LT.stairs.stepRule = 'before';
  }
  const w = new W.Walker(p, clips, cycles);
  w.walk = gait === 'walk';
  w.place(0, way > 0 ? 0.02 : count * riser + 0.02, 0);
  const dt = 1 / fps;
  const land = (opt.landing ?? 0) * tread;
  const end = 2 + count * tread + (opt.half ? land - tread : 0);
  // The middle of the flight, past its first tread and short of its last; or (whole) the whole run, the floor before it and
  // the floor after it as well, its ends' first and last steps among them.
  const lo = opt.whole ? 0.8 : 2 + tread;
  // (`far`: on to 3 m past the flight's end, where 33d3e67's hold, 1.3 m past its last riser, hands the walk back.)
  const hi = opt.whole ? end + (opt.far ? 3 : 1.2) : end - tread;
  const r: Run = { n: 0, planted: 0, off: 0, worst: 0, over: 0, falls: 0, crossed: 0, stances: 0, slides: 0, slide: 0, speed: 0, asked: 0, rate: 0, bad: 0, knownOff: false, strideAfter: 0, gaps: [] };
  const was = [0, 0];
  const st: (number[] | null)[] = [null, null];
  // Which tread a point is on: its index by the flight's own edges (the landing one long tread).
  const edges: number[] = [];
  {
    let e = 2;
    for (let i = 0; i < count; i++) {
      edges.push(e);
      e += opt.half && i === opt.half ? land : tread;
    }
    edges.push(e);
  }
  const treadOf = (x: number) => {
    let k = -1;
    while (k + 1 < edges.length && x >= edges[k + 1]) k++;
    return k;
  };
  let x0 = Number.NaN;
  let t0 = 0;
  let x1 = 0;
  let t1 = 0;
  let frames = 0;
  let rows = 0;
  let lastTread = Number.NaN;
  for (let i = 0; i < 25 * fps; i++) {
    const row = w.frame(dt);
    for (const l of row.legs) for (const v of [...l.heel, ...l.ball]) if (!Number.isFinite(v)) r.bad++;
    if (row.x > Math.max(end + 1.5, hi + 0.3)) {
      rows++;
      if (rows > 0.5 * fps) break;
      continue;
    }
    const on = row.x > lo && row.x < hi && (row.known || !!opt.before || !!opt.whole);
    if (!on) {
      st[0] = st[1] = null;
      continue;
    }
    frames++;
    if (Number.isNaN(x0)) {
      x0 = row.x;
      t0 = row.t;
    }
    x1 = row.x;
    t1 = row.t;
    r.n = Math.max(r.n, row.n);
    r.rate += row.rate;
    r.asked += w.loco.step.speed;
    for (let s = 0; s < 2; s++) {
      const l = row.legs[s];
      if (l.planted >= 0.5 && was[s] < 0.5) {
        r.falls++;
        // Which tread it came down on (the floor before the flight -1, the floor after it the count), and how far from the last.
        const k = treadOf((l.heel[0] + l.ball[0]) / 2);
        if (lastTread === lastTread) r.gaps.push(k - lastTread);
        lastTread = k;
      }
      was[s] = l.planted;
      if (l.planted >= 0.99 && l.grounded) {
        r.planted++;
        const g = Math.min(l.heel[1] - prof(l.heel[0]), l.ball[1] - prof(l.ball[0]));
        if (Math.abs(g) > Math.abs(r.worst)) r.worst = g;
        if (Math.abs(g) > 0.01) {
          r.off++;
        }
        if (treadOf(l.heel[0]) !== treadOf(l.ball[0])) r.over++;
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
        const sl = Math.max(q[1] > q[0] ? q[1] - q[0] : 0, q[3] > q[2] ? q[3] - q[2] : 0);
        r.stances++;
        if (sl > 0.02) r.slides++;
        r.slide = Math.max(r.slide, sl);
        st[s] = null;
      }
    }
  }
  r.crossed = Math.abs(x1 - x0) / tread;
  r.speed = (x1 - x0) / (t1 - t0);
  r.rate /= frames;
  r.asked /= frames;
  r.knownOff = !w.sense.known;
  r.strideAfter = w.loco.step.stride;
  [LT.stairs.pin, LT.ik.hips, LT.stairs.cycle, LT.stairs.stepRule] = was0 as unknown as [typeof LT.stairs.pin, typeof LT.ik.hips, typeof LT.stairs.cycle, typeof LT.stairs.stepRule];
  [LT.step.rule, LT.stairs.hold, LT.stairs.riserMax, LT.stairs.treadMax, LT.stairs.look, LT.stairs.mirror] = two0 as unknown as [typeof LT.step.rule, typeof LT.stairs.hold, number, number, number, typeof LT.stairs.mirror];
  return r;
}
const say = (r: Run) => `n ${r.n}, ${r.speed.toFixed(2)} m/s (the step asks ${r.asked.toFixed(2)}), rate ${r.rate.toFixed(2)}; ${r.planted} planted frames, ${r.off} off their tread by over 1 cm (worst ${(r.worst * 1000).toFixed(0)} mm), ${r.over} over a nosing; ${r.falls} footfalls over ${r.crossed.toFixed(1)} treads; ${r.stances} stances, ${r.slides} sliding over 2 cm (worst ${(r.slide * 1000).toFixed(0)} mm)`;
const FLIGHTS: [number, number][] = [[0.28, 0.17], [0.32, 0.15], [0.4, 0.2], [0.2, 0.12]];
for (const [tread, riser] of FLIGHTS) {
  for (const way of [1, -1]) {
    const r = await walkFlight(tread, riser, way, 'walk', 60);
    const tag = `${tread}/${riser} walking ${way > 0 ? 'up' : 'down'} at 60 frames a second`;
    ok(r.bad === 0 && r.planted > 100 && r.off <= 0.08 * r.planted && Math.abs(r.worst) < 0.05 && r.over === 0, `${tag}: every planted foot on a tread and none over a nosing (${say(r)})`);
    // (Two treads a step stand half as many stances over the stretch measured.)
    ok(r.stances >= (r.n > 1 ? 5 : 8) && r.slides === 0, `${tag}: no planted foot slides more than 2 cm along its tread (worst ${(r.slide * 1000).toFixed(0)} mm over ${r.stances} stances)`);
    ok(Math.abs(r.falls - r.crossed / r.n) <= 2.5, `${tag}: a footfall every ${r.n} tread${r.n > 1 ? 's' : ''} (${r.falls} over ${r.crossed.toFixed(1)} treads)`);
  }
}
for (const fps of [30, 144]) {
  for (const way of [1, -1]) {
    const r = await walkFlight(0.28, 0.17, way, 'walk', fps);
    const tag = `0.28/0.17 walking ${way > 0 ? 'up' : 'down'} at ${fps} frames a second`;
    // At 144 frames a second the capsule hops off a riser for a frame or two going up; the feet keep their weight and the
    // stair clip's measure through it (FootIk's hop), where they once let go and stood a sixth of their frames up to 8 cm
    // into the treads.
    const share = 0.08;
    ok(r.bad === 0 && r.off <= share * r.planted && Math.abs(r.worst) < 0.05 && r.over === 0 && r.slides === 0 && Math.abs(r.falls - r.crossed / r.n) <= 2.5, `${tag}: feet on the treads, none sliding (${say(r)})`);
  }
}
{
  const now = await walkFlight(0.28, 0.17, 1, 'walk', 60);
  const then = await walkFlight(0.28, 0.17, 1, 'walk', 60, { before: true });
  ok(then.over > now.over && then.off / then.planted > now.off / now.planted && then.slide > now.slide, `today's rule beside (every switch at 'before', 9c18665's stairs), walking up 0.28/0.17: ${then.off} of ${then.planted} planted frames off their tread (worst ${(then.worst * 1000).toFixed(0)} mm), ${then.over} over a nosing, ${then.slides} of ${then.stances} stances sliding over 2 cm (worst ${(then.slide * 1000).toFixed(0)} mm), a footfall ${then.falls} times over ${then.crossed.toFixed(1)} treads; against ${now.off} of ${now.planted}, ${now.over}, ${now.slides} and ${now.falls}`);
}
{
  const pinned = await walkFlight(0.28, 0.17, -1, 'walk', 60);
  const loose = await walkFlight(0.28, 0.17, -1, 'walk', 60, { pin: 'off' });
  ok(loose.slides > pinned.slides && loose.slide > 0.02, `mutation: with stairs.pin 'off' a planted foot walking down slides ${(loose.slide * 1000).toFixed(0)} mm (${loose.slides} of ${loose.stances} stances over 2 cm), against ${(pinned.slide * 1000).toFixed(0)} mm held`);
}
{
  const r = await walkFlight(0.28, 0.17, 1, 'walk', 60, { half: 6, landing: 3 });
  // Stairs II: a landing three treads long (0.84 m) is longer than `treadMax` (0.79): the stair clip is handed to the walk at
  // the footfall onto it and taken on again `takeOn` before the next riser, so one stance of the walk stands on the landing,
  // the walk's first after a hand-over, which slides a few centimetres at every flight's end (see the whole flights below).
  ok(r.bad === 0 && r.over === 0 && r.slides <= 1 && r.slide < 0.045 && Math.abs(r.falls - r.crossed / r.n) <= 2.5, `a flight with a landing three treads long halfway, walking up: no foot over a nosing, a footfall a tread, and no foot sliding but the walk's one stance on the landing, under 4.5 cm (${say(r)})`);
  const whole = await walkFlight(0.28, 0.17, 1, 'walk', 60, { half: 6, landing: 3, twoBefore: true });
  ok(whole.slides === 0 && whole.over === 0, `and with Stairs II's switches at 33d3e67's (the landing a tread of the flight) none slides at all (${say(whole)})`);
  note(`the first foot onto the flight after the landing stands over its tread for most of a second (${r.off} of ${r.planted} planted frames off by over 1 cm, worst ${(r.worst * 1000).toFixed(0)} mm): the stair clip's step reaches a riser up from the landing and the leg cannot press it down; the steering and the stride take the landing's tread for the flight's (a fault left)`);
  ok(r.knownOff && r.strideAfter === 1, `and past the flight's end the stairs are let go and the stride is whole again`);
}
for (const [tread, riser] of FLIGHTS) {
  for (const way of [1, -1]) {
    const r = await walkFlight(tread, riser, way, 'run', 60);
    ok(r.bad === 0 && r.falls > 2 && r.gaps.every((g) => g === r.n), `${tread}/${riser} running ${way > 0 ? 'up' : 'down'} at 60 frames a second runs the flight with a number everywhere, every footfall ${r.n} tread${r.n > 1 ? 's' : ''} on from the last (${r.falls} footfalls: ${r.gaps.join(' ')})`);
    note(`${tread}/${riser} running ${way > 0 ? 'up' : 'down'}: ${say(r)}; treads between footfalls ${r.gaps.join(' ')}`);
  }
}
// The flight's ends (the review's): walked onto and off, up and down, at 60 and 144 frames a second, the whole run measured
// (the floor before the flight, its first and last steps, the floor after). The walk at the top starts in step with the
// stair cycle it takes over from (`CharacterRig.addStairCycles`); started from its own start, the foot planted on the last
// tread swung through the fade and skimmed 38 cm along the floor at 144 frames a second.
for (const fps of [60, 144]) {
  for (const way of [1, -1]) {
    const r = await walkFlight(0.28, 0.17, way, 'walk', fps, { whole: true });
    const tag = `0.28/0.17 walking onto the flight and off it ${way > 0 ? 'up' : 'down'} at ${fps} frames a second`;
    // Stairs II: the walk is handed back at the footfall past the last riser, inside this stretch, and its first stance
    // slides a few centimetres; 33d3e67's hand-over, 1.3 m past the last riser (just beyond the stretch), slid more.
    // (Its toe-off lifts the heel 3 cm a frame or two before the stance is let go.)
    ok(r.bad === 0 && r.over === 0 && r.off <= 0.01 * r.planted && Math.abs(r.worst) < 0.035 && r.slide <= 0.045, `${tag}: every planted foot on its tread or the floor, none over a nosing and none sliding more than 4.5 cm (${say(r)})`);
    const far = await walkFlight(0.28, 0.17, way, 'walk', fps, { whole: true, far: true });
    const then = await walkFlight(0.28, 0.17, way, 'walk', fps, { whole: true, far: true, twoBefore: true });
    ok(far.slide < then.slide, `${tag}, on to 3 m past the flight: the walk handed back at the last step slides ${(far.slide * 1000).toFixed(0)} mm at most, where with Stairs II's switches at 33d3e67's the walk handed back 1.3 m on slides ${(then.slide * 1000).toFixed(0)} mm`);
    if (far.off > 0) note(`${tag}: the walk's first toe-off after the hand-over at the last step stands its heel up to ${(far.worst * 1000).toFixed(0)} mm over the floor for a frame or two before the stance is let go (${far.off} frames; with Stairs II's switches at 33d3e67's ${(then.worst * 1000).toFixed(0)} mm): a fault left`);
  }
}
// Running, the flight's middle: every footfall n treads on from the last (the review's: one in two landed three treads on
// and the next one, the stride's pivot one leg's for both).
for (const fps of [60, 144]) {
  for (const way of [1, -1]) {
    const r = await walkFlight(0.28, 0.17, way, 'run', fps);
    ok(r.n === 2 && r.gaps.length >= 3 && r.gaps.every((g) => g === r.n), `0.28/0.17 running ${way > 0 ? 'up' : 'down'} at ${fps} frames a second: every footfall ${r.n} treads on from the last (${r.gaps.join(' ')})`);
  }
  for (const way of [1, -1]) {
    const r = await walkFlight(0.28, 0.17, way, 'run', fps, { whole: true });
    note(`0.28/0.17 running onto the flight and off it ${way > 0 ? 'up' : 'down'} at ${fps} frames a second: ${say(r)}; treads between footfalls ${r.gaps.join(' ')} (the first stance onto the flight and the last off it are not held: a fault left)`);
  }
}console.log(`stairStep: ${checks} checks passed`);
