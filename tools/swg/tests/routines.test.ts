// The travellers at a port (src/world/ambient/routines.ts): who comes to a round of a port's shuttle and
// when, drawn from the port's clock name and the round and nothing else, so the same inputs give the same
// people in every browser; a departure's day by the clock, whose boarding window is exactly the one
// `shuttleAt` calls `waiting` for the same round; where one met part way through its day is stood; the
// walk from the door to the terminal, out to the collector, the wait for the landing and the ramp; the
// arrival stepping off; and the rule that lets a walker go rather than leave it stuck. Every clock and
// every "has it got there" is the test's own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRAVEL_TUNE, shuttleAt, shuttleEvery, shuttleRound, type ShuttleTimes } from '../../../src/world/travelTerminal.ts';
import {
  ROUTINE_TUNE,
  arrivalPhase,
  departurePhase,
  departureStart,
  giveBack,
  newWalk,
  newHeadway,
  restartHeadway,
  roundSeed,
  stalled,
  standFacing,
  stepDeparture,
  travellersOf,
  walkDecision,
  walkTo,
  type DepartureState,
  type TravellerPlan,
} from '../../../src/world/ambient/routines.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

const PORTS = ['tatooine|Mos Eisley Starport', 'naboo|Theed Starport', 'tatooine|Anchorhead Shuttleport', 'corellia|Coronet Shuttle A'];
const TIMES: (ShuttleTimes | null)[] = [null, { land: 26.6, lift: 26.6 }, { land: 20.8, lift: 20.8 }, { land: 32.3, lift: 30 }];
/** A clock like the one the wall gives: some day in 2026, in seconds. */
const BASE = 1_790_000_000;

// ---- 1: a round's moments are shuttleAt's own ------------------------------------------------------
{
  let agreed = 0;
  let asked = 0;
  for (const name of PORTS) {
    for (const times of TIMES) {
      const every = shuttleEvery(TRAVEL_TUNE, times);
      const first = Math.floor(BASE / every);
      for (let slot = first; slot < first + 40; slot++) {
        const r = shuttleRound(name, slot, TRAVEL_TUNE, times);
        const probes: [number, string][] = [
          [r.land + 0.01, 'landing'],
          [r.wait - 0.01, 'landing'],
          [r.wait + 0.01, 'waiting'],
          [r.leave - 0.01, 'waiting'],
          [r.leave + 0.01, 'leaving'],
          [r.gone - 0.01, 'leaving'],
          [r.gone + 0.01, 'away'],
          [r.land - 0.01, 'away'],
        ];
        for (const [t, want] of probes) {
          asked++;
          if (shuttleAt(name, t, TRAVEL_TUNE, times).phase === want) agreed++;
        }
      }
    }
  }
  // And what the collector says of the next shuttle is the next round's own landing, from any moment.
  let right = 0;
  let told = 0;
  for (let k = 0; k < 400; k++) {
    const name = PORTS[k % 4];
    const times = TIMES[k % 4];
    const every = shuttleEvery(TRAVEL_TUNE, times);
    const t = BASE + k * 37.3;
    const s = shuttleAt(name, t, TRAVEL_TUNE, times);
    if (s.phase === 'waiting') continue;
    const slot = Math.floor(t / every);
    const here = shuttleRound(name, slot, TRAVEL_TUNE, times);
    const next = t < here.land ? here : shuttleRound(name, slot + 1, TRAVEL_TUNE, times);
    const want = s.phase === 'landing' ? here.wait : next.land;
    told++;
    if (Math.abs(t + s.until - want) < 1e-6) right++;
  }
  ok(right === told, `the time the collector gives until the next shuttle is the moment it really comes, from every phase: ${right} of ${told}`);
  ok(agreed === asked, `a round's landing, wait, lift-off and leaving are the moments shuttleAt changes phase at: ${agreed} of ${asked} probes over four ports, four rigs and forty rounds each`);
  const r = shuttleRound(PORTS[0], 1000, TRAVEL_TUNE, TIMES[1]);
  ok(near(r.wait - r.land, 26.6) && near(r.leave - r.wait, TRAVEL_TUNE.waits) && near(r.gone - r.leave, 26.6), "... with the rig's own landing, the wait, and its own lift-off between them");
}

// ---- 2: the same inputs give the same people -------------------------------------------------------
{
  const r = shuttleRound(PORTS[0], 5_966_000, TRAVEL_TUNE, TIMES[1]);
  const a: TravellerPlan[] = [];
  const b: TravellerPlan[] = [];
  const na = travellersOf(PORTS[0], r, 4, a, 0);
  const nb = travellersOf(PORTS[0], r, 4, b, 0);
  ok(na === nb && JSON.stringify(a.slice(0, na)) === JSON.stringify(b.slice(0, nb)), 'the same port, round and terminals give the same travellers, drawn and timed alike: two browsers agree with nothing sent');
  ok(roundSeed(PORTS[0], 17) === roundSeed(PORTS[0], 17) && roundSeed(PORTS[0], 17) !== roundSeed(PORTS[1], 17), "a round's seed is its port's clock name and its number");
  const reused = a.slice();
  travellersOf(PORTS[0], r, 4, a, 0);
  ok(a.every((p, i) => p === reused[i]), '... and the list is written over in place, its entries kept');
  // Over many rounds: the counts, the order, the windows.
  let departures = 0;
  let arrivals = 0;
  let inRange = true;
  let ordered = true;
  let windows = true;
  let terminals = true;
  const seenCounts = new Set<string>();
  for (let slot = 0; slot < 600; slot++) {
    const round = shuttleRound(PORTS[slot % 4], slot, TRAVEL_TUNE, TIMES[slot % 4]);
    const out: TravellerPlan[] = [];
    const n = travellersOf(PORTS[slot % 4], round, 4, out, 0);
    const d = out.slice(0, n).filter((p) => p.kind === 'depart');
    const c = out.slice(0, n).filter((p) => p.kind === 'arrive');
    departures += d.length;
    arrivals += c.length;
    seenCounts.add(`${d.length}/${c.length}`);
    if (d.length < ROUTINE_TUNE.departures[0] || d.length > ROUTINE_TUNE.departures[1] || c.length < ROUTINE_TUNE.arrivals[0] || c.length > ROUTINE_TUNE.arrivals[1]) inRange = false;
    for (let i = 1; i < d.length; i++) if (d[i].appearAt < d[i - 1].appearAt) ordered = false;
    for (const p of d) if (p.appearAt < round.land - ROUTINE_TUNE.appear - 1e-9 || p.appearAt > round.land - ROUTINE_TUNE.appear + ROUTINE_TUNE.stagger + 1e-9 || p.wait !== round.wait || p.leave !== round.leave) windows = false;
    for (const p of c) if (p.appearAt < round.wait + ROUTINE_TUNE.offAfter - 1e-9 || p.appearAt >= round.leave - ROUTINE_TUNE.offBefore + 1e-9) windows = false;
    const t = d.map((p) => p.terminal);
    if (t.some((x) => x < 0 || x >= 4) || new Set(t).size !== t.length) terminals = false;
  }
  ok(inRange, `over 600 rounds every round has ${ROUTINE_TUNE.departures.join(' to ')} departures and ${ROUTINE_TUNE.arrivals.join(' to ')} arrivals (the design's numbers)`);
  ok(seenCounts.has('1/0') && seenCounts.has('3/3'), `... and the whole of both ranges comes up: ${departures} departures and ${arrivals} arrivals in all`);
  ok(ordered, "a round's departures come in in order, the first always first through the door");
  ok(windows, `each comes in ${ROUTINE_TUNE.appear} s before its landing, within ${ROUTINE_TUNE.stagger} s of the first; every arrival steps off ${ROUTINE_TUNE.offAfter} s or more after its shuttle has landed and ${ROUTINE_TUNE.offBefore} s or more before it lifts off`);
  // A tune that would put the arrivals after the lift-off, or before the landing is over, is held to the wait.
  let held = true;
  let arrivalsSeen = 0;
  for (const offAfter of [100, 1000, -50]) {
    for (let slot = 0; slot < 200; slot++) {
      const round = shuttleRound(PORTS[slot % 4], slot, TRAVEL_TUNE, TIMES[slot % 4]);
      const out: TravellerPlan[] = [];
      const n = travellersOf(PORTS[slot % 4], round, 4, out, 0, { ...ROUTINE_TUNE, offAfter });
      for (const p of out.slice(0, n)) {
        if (p.kind !== 'arrive') continue;
        arrivalsSeen++;
        if (p.appearAt < round.wait || p.appearAt >= round.leave) held = false;
      }
    }
  }
  ok(held && arrivalsSeen > 100, `moved live to step off 100 s, 1000 s or -50 s after the landing, every one of ${arrivalsSeen} arrivals still steps off while its shuttle waits`);
  ok(terminals, 'with four terminals the departures of one round each take a terminal of their own');
  const none: TravellerPlan[] = [];
  const n0 = travellersOf(PORTS[2], shuttleRound(PORTS[2], 3, TRAVEL_TUNE, null), 0, none, 0);
  ok(none.slice(0, n0).every((p) => p.terminal === -1), 'at a port with no terminal a departure has none, and goes straight to the collector');
}

// ---- 3: a departure's day by the clock matches the shuttle -----------------------------------------
{
  let asked = 0;
  let agreed = 0;
  let before = 0;
  for (let k = 0; k < 60; k++) {
    const name = PORTS[k % 4];
    const times = TIMES[k % 4];
    const every = shuttleEvery(TRAVEL_TUNE, times);
    const round = shuttleRound(name, Math.floor(BASE / every) + k, TRAVEL_TUNE, times);
    const out: TravellerPlan[] = [];
    const n = travellersOf(name, round, 4, out, 0);
    for (const p of out.slice(0, n)) {
      if (p.kind !== 'depart') continue;
      for (let t = p.appearAt - 3; t < round.gone + 3; t += 0.73) {
        const phase = departurePhase(p, t);
        if (t < p.appearAt) {
          before++;
          assert.equal(phase, 'before');
          continue;
        }
        // Within its own round's window, boarding is exactly the shuttle waiting.
        if (t >= round.land && t < round.gone) {
          asked++;
          const waiting = shuttleAt(name, t, TRAVEL_TUNE, times).phase === 'waiting';
          if ((phase === 'board') === waiting) agreed++;
        }
        if (t >= round.leave) assert.equal(phase, 'gone');
      }
    }
  }
  ok(before > 0 && agreed === asked, `a departure boards exactly while shuttleAt says its round's shuttle is waiting, and is gone once it lifts off: ${agreed} of ${asked} moments over sixty rounds`);
  const p = { appearAt: 100, wait: 250, leave: 310 };
  ok(departurePhase(p, 99.9) === 'before' && departurePhase(p, 100) === 'come' && departurePhase(p, 249.9) === 'come' && departurePhase(p, 250) === 'board' && departurePhase(p, 310) === 'gone', 'before, on its way, boarding, gone: at the moments its plan names');
  ok(arrivalPhase({ appearAt: 50 }, 49) === 'before' && arrivalPhase({ appearAt: 50 }, 50) === 'walk' && arrivalPhase({ appearAt: 50 }, 50 + ROUTINE_TUNE.walkMax) === 'gone', `an arrival walks from the moment it steps off, and is let go ${ROUTINE_TUNE.walkMax} s later wherever it has got to`);
}

// ---- 4: met part way through its day ---------------------------------------------------------------
{
  const plan: TravellerPlan = { kind: 'depart', round: 1, index: 0, seed: 1, appearAt: 1000, stand: 8, terminal: 2, door: 0.5, spot: 0.5, far: 0.5, wait: 1150, leave: 1210 };
  const legs = { toTerminal: 13, toCollector: 26 };
  const walk = (legs.toTerminal * ROUTINE_TUNE.winding) / ROUTINE_TUNE.pace;
  const s: DepartureState = { stage: 'enter', standUntil: 0 };
  ok(departureStart(plan, 999, legs, s) === null, 'one not come yet is not stood');
  ok(departureStart(plan, 1005, legs, s) === 'enter', 'met on its way in, it is stood at the door and walks to its terminal');
  ok(departureStart(plan, 1000 + walk + 1, legs, s) === 'terminal' && near(s.standUntil, 1000 + walk + 8), `met while it would be at its terminal (the way in at ${ROUTINE_TUNE.pace} m/s, ${ROUTINE_TUNE.winding} times the straight line), it is stood there with what is left of its time`);
  ok(departureStart(plan, 1000 + walk + 9, legs, s) === 'waiting', '... and after that, at the collector, waiting for the shuttle');
  ok(departureStart(plan, 1160, legs, s) === 'board', 'met with its shuttle already down, it walks from the collector to the ramp');
  ok(departureStart(plan, 1210, legs, s) === null, 'met after its shuttle has lifted off, it is not stood at all');
  const open: TravellerPlan = { ...plan, terminal: -1 };
  ok(departureStart(open, 1002, legs, s) === 'out' && departureStart(open, 1000 + (26 * ROUTINE_TUNE.winding) / ROUTINE_TUNE.pace + 1, legs, s) === 'waiting', 'at a port with no terminal it walks straight to the collector, and waits there');
}

// ---- 5: its day, step by step ------------------------------------------------------------------------
{
  const plan: TravellerPlan = { kind: 'depart', round: 1, index: 0, seed: 1, appearAt: 1000, stand: 8, terminal: 0, door: 0.5, spot: 0.5, far: 0.5, wait: 1150, leave: 1210 };
  const s: DepartureState = { stage: 'enter', standUntil: 0 };
  ok(stepDeparture(s, plan, 1005, false) === 'enter', 'walking in, it walks until it gets there');
  ok(stepDeparture(s, plan, 1020, true) === 'terminal' && near(s.standUntil, 1028), 'at its terminal it stands its time there, from the moment it arrived');
  ok(stepDeparture(s, plan, 1027.9, false) === 'terminal' && stepDeparture(s, plan, 1028, false) === 'out', '... and then walks out to the collector');
  ok(stepDeparture(s, plan, 1060, true) === 'waiting', 'at the collector before the landing, it waits');
  ok(stepDeparture(s, plan, 1149.9, false) === 'waiting' && stepDeparture(s, plan, 1150, false) === 'board', '... until the shuttle has really landed, and then walks to the ramp');
  ok(stepDeparture(s, plan, 1170, false) === 'board' && stepDeparture(s, plan, 1175, true) === 'boarded', 'and at the ramp it boards');
  ok(stepDeparture(s, plan, 1300, false) === 'boarded', 'boarded is boarded: the lift-off does not undo it');
  const slow: DepartureState = { stage: 'enter', standUntil: 0 };
  ok(stepDeparture(slow, plan, 1150, false) === 'out', 'still walking in when its shuttle lands, it has its ticket and makes for the shuttle rather than miss it');
  const queued: DepartureState = { stage: 'terminal', standUntil: 1200 };
  ok(stepDeparture(queued, plan, 1150, false) === 'out', '... and one at a terminal leaves it then, its time there cut short');
  const late: DepartureState = { stage: 'out', standUntil: 0 };
  ok(stepDeparture(late, plan, 1160, true) === 'board', 'reaching the collector with the shuttle already down, it goes straight on to the ramp');
  for (const stage of ['enter', 'terminal', 'out', 'waiting', 'board'] as const) {
    const left: DepartureState = { stage, standUntil: 2000 };
    assert.equal(stepDeparture(left, plan, 1210, false), 'gone');
  }
  ok(true, 'whatever it is doing, the shuttle lifting off without it lets it go');
}

// ---- 6: never left stuck -----------------------------------------------------------------------------
{
  const G = ROUTINE_TUNE.giveUp;
  const L = ROUTINE_TUNE.lost;
  const h = newHeadway(100);
  ok(!stalled(h, 30, 0, 0, 100, false, G, L), 'a walk begun is not stalled');
  ok(!stalled(h, 30, 0.4, 0, 100 + G - 0.1, false, G, L), `pressed against something, it keeps trying for ${G} s`);
  ok(stalled(h, 30, 0.6, 0, 100 + G, false, G, L), '... and then it is let go: shuffling half a metre is not moving');
  // Walking the long way round: moving all the time, and no nearer its goal for a while.
  const round = newHeadway(0);
  let lostAt = -1;
  for (let t = 0; t < 3 * L; t += 1) {
    const d = 50 + 0.05 * t;
    if (stalled(round, d, Math.cos(t / 5) * 30, Math.sin(t / 5) * 30, t, false, G, L)) {
      lostAt = t;
      break;
    }
  }
  ok(lostAt === L, `one that goes on moving but never gets nearer is lost after ${L} s, not ${G}: a detour round a building takes a walker away before it brings it nearer (let go at ${lostAt} s)`);
  const g = newHeadway(0);
  let gone = false;
  let d = 100;
  for (let t = 0; t < 10 * L; t += 1) {
    d -= 0.06;
    if (stalled(g, d, t * 0.06, 0, t, false, G, L)) gone = true;
  }
  ok(!gone, 'one getting nearer, however slowly, is never let go');
  // A walk under way first, so both clocks have something to go on (a first walked step after nothing
  // but still ones would start the nearer-clock afresh whatever the still ones did); then held still for
  // longer than either clock, then walked again as far off as before.
  const k = newHeadway(0);
  ok(!stalled(k, 50, 0, 0, 0, false, G, L) && !stalled(k, 50, 0.2, 0, 1, false, G, L), 'a walk under way, fifty metres off');
  let held = false;
  const lastStill = 2 + 2 * L;
  for (let t = 2; t <= lastStill; t++) if (stalled(k, 50, 0, 0, t, true, G, L)) held = true;
  ok(!held && !stalled(k, 50, 0, 0, lastStill + 1, false, G, L), `time a body cannot move at all (too far off to be walked, its model loading) is not counted: ${2 * L} s held still, then walked again no nearer, it is not taken for lost or stuck`);
  ok(!stalled(k, 50, 0.3, 0, lastStill + G - 1, false, G, L) && stalled(k, 50, 0.3, 0, lastStill + G, false, G, L), '... and the clocks run again from the last moment it could not move');
  restartHeadway(k, 1000);
  ok(!stalled(k, 50, 0, 0, 1000 + G - 1, false, G, L), 'a walk begun again starts both clocks again');
}
// ---- 7: what the body acts on ----------------------------------------------------------------------------
{
  const w = newWalk();
  walkTo(w, 5, 7, null, 3);
  const d = walkDecision(null, w);
  ok(d.state === 'wander' && d.moveTo === w.goal && d.face === w.goal && d.pace === 'walk' && d.targetKey === null && w.room === 0, 'walking: it walks to its goal at a walk, after nobody, and a goal out in the open has no room');
  standFacing(w, 1, 2);
  const e = walkDecision(d, w);
  ok(e === d && e.state === 'idle' && e.moveTo === null && e.face === w.face && e.pace === 'stand', 'standing: the same kept decision, going nowhere, facing what it was given');
  standFacing(w, null, null);
  ok(walkDecision(d, w).face === null, '... or as it is, given nothing to face');
}

// ---- 8: how the game walks them ------------------------------------------------------------------------
{
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mobile = src('world/mobiles/mobile.ts');
  const world = src('world/world.ts');
  const runner = src('world/ambient/ambientPeople.ts');
  const between = (s: string, from: string, to: string): string => {
    const a = s.indexOf(from);
    const b = a >= 0 ? s.indexOf(to, a + from.length) : -1;
    return a >= 0 && b > a ? s.slice(a, b) : '';
  };
  ok(/if \(this\.routine && this\.now >= this\.thinkAt && !this\.downPhase\) \{\s*this\.thinkRoutine\(\);/.test(mobile) && /if \(!this\.routine && this\.now >= this\.thinkAt/.test(mobile), 'a body with a routine thinks its routine, and never the brain or a town walker’s round');
  const think = between(mobile, '  private thinkRoutine(): void {', '\n  }\n');
  ok(/const d = walkDecision\(this\.walkerDecision, w\);/.test(think) && /this\.walkerDecision = d;/.test(think) && /this\.goal = d\.goal;/.test(think) && /this\.state = d\.state;/.test(think) && /this\.decision = d;/.test(think), '... and hands the walk its routine gives it to the body: its goal, its state and the decision the body moves and faces by');
  ok(/if \(w\.going\) \{\s*this\.homeX = w\.goal\.x;\s*this\.homeZ = w\.goal\.z;/.test(think), '... with its home at the point it walks to, so no leash pulls it back to where it was stood');
  const sit = between(mobile, '  sit(x: number, y: number, z: number, heading: number): void {', '\n  }\n');
  const rise = between(mobile, '  rise(x: number, z: number): void {', '\n  }\n');
  ok(/this\.seatAt = \{ x, y, z, heading \};/.test(sit) && /setBodyType\(RAPIER\.RigidBodyType\.KinematicPositionBased, true\)/.test(sit) && /this\.roles\.idle = this\.laidIdle;/.test(sit), 'sat down, a body is held on its seat out of the solver and takes the sitting idle it was lent');
  ok(/if \(this\.downPhase\) \{\s*this\.downPhase = null;/.test(sit), '... up at once if it was knocked down on the way there, since nothing sat would get it up again');
  ok(/this\.seatAt = null;/.test(rise) && /setBodyType\(RAPIER\.RigidBodyType\.Dynamic, true\)/.test(rise) && /this\.roles\.idle = this\.plainIdle;/.test(rise) && /resetStepWalker\(this\.stepWalk\)/.test(rise), 'getting up, it is a body in the solver again, standing in its own idle, its step-up begun afresh');
  const upd = between(mobile, '  update(', '    // 7. Timers.');
  ok(/if \(this\.seatAt\) \{\s*if \(this\.routine && this\.now >= this\.thinkAt\) \{\s*this\.thinkRoutine\(\);[\s\S]*?this\.animate\(sdt, tier\);\s*return;\s*\}/.test(upd), 'sat, a body only thinks its routine and is drawn: none of the rest of its update moves it off the seat');
  const knock = between(mobile, '  knock(dir: THREE.Vector3, power: number): void {', '\n  }\n');
  const hold = between(mobile, '  holdAt(point: THREE.Vector3, dt: number): void {', '\n  }\n');
  ok(/if \([^)]*this\.seatAt[^)]*\) return;/.test(knock) && /if \([^)]*this\.seatAt[^)]*\) return;/.test(hold) && /this\.knock\(dir, power\);/.test(between(mobile, '  release(dir: THREE.Vector3, power: number): void {', '\n  }\n')), 'a shove, a grip and a throw leave a sat body sat: a knockdown there would lie at the chair until its stay was out');
  ok(/case 'terminal':[\s\S]{0,200}?standFacing\(w, r\.terminal\.faceX, r\.terminal\.faceZ\)/.test(runner) && /heading = Math\.atan2\(terminal\.faceX - where\.x, terminal\.faceZ - where\.z\);/.test(runner), 'at its terminal a departure faces the terminal itself, not the spot it stands on');
  // (and one on a detour off the clutter it stalled in, step 10, is never taken to have reached anything at the detour's end)
  ok(/stepDeparture\(r\.state, r\.plan!, seconds, !r\.detour && !r\.via && w\.going && d <= reach\)/.test(runner) && /if \(r\.via && !r\.detour && \(!m\.inside \|\| d <= ROUTINE_TUNE\.reach\)\) \{\s*r\.via = null;/.test(runner), 'a departure with a door to pass first is never taken to have reached the collector at the door');
  const step = between(runner, '  step(dt: number, now: number, at: THREE.Vector3, deps: AmbientDeps, force = false): void {', '\n  }\n');
  ok(step.indexOf('this.shedForMemory(at, deps);') > 0 && step.indexOf('this.shedForMemory(at, deps);') < step.indexOf('if (this.records.size >= allowance) return;'), "ours give model memory back to the data's own people before a full share of the cap ends the pass");
  const yieldSrc = between(runner, '  private shedForMemory(at: THREE.Vector3, deps: AmbientDeps): void {', '\n  }\n');
  ok(/last\.pass === this\.yieldedFor/.test(yieldSrc) && /giveBack\(list, list\.length, last\.shortBytes,/.test(yieldSrc), '... once for each of their passes that was short, and only a set of ours that covers what they were short of (`giveBack`)');
  ok(/private placeOfGoal[\s\S]{0,500}?const w = this\.routine;\s*if \(w\) \{\s*if \(!w\.going\) return null;\s*this\.goalPlace\.building = w\.building;/.test(mobile), "... and the doorway join is told the room its routine's goal stands in, so it walks in and out through doors");
  const people = world.indexOf('standingPeople.step(dt, this.simTime, playerPos, this.peopleDeps());');
  const ours = world.indexOf('ambientPeople.step(dt, this.simTime, playerPos, this.ambientDeps());');
  ok(people > 0 && ours > people, "the people of ours are stepped after the data's own, whose places they leave alone");
  ok(/worldId: `ours:\$\{how\.id\}`,\s*essential: true,/.test(world) && !/ours:[\s\S]{0,400}share: true/.test(world.slice(world.indexOf('ambientDeps(): AmbientDeps'), world.indexOf('ambientDeps(): AmbientDeps') + 1500)), 'every one of ours is stood as `ours:`, part of the furniture, and never shared with a server');
}

// ---- 9: giving the data's own people back model memory ------------------------------------------------
{
  // A model memory made of each body's own bytes and one piece `sharers` hold between them, counted once
  // while any of them is outside the set: a set gives back its own bytes, and the piece only once every
  // one holding it is in the set.
  const tally = (own: Record<string, number>, sharers: string[] = [], piece = 0) => {
    let set: string[] = [];
    return {
      start: () => {
        set = [];
      },
      add: (who: string): number => {
        set.push(who);
        const bytes = set.reduce((n, w) => n + own[w], 0);
        return bytes + (sharers.length && sharers.every((s) => set.includes(s)) ? piece : 0);
      },
    };
  };
  const chosen: number[] = [];
  const pick = (list: string[], want: number, t: ReturnType<typeof tally>): string => {
    const n = giveBack(list, list.length, want, t.start, t.add, chosen);
    return chosen.slice(0, n).map((i) => list[i]).join();
  };
  // Farthest first: a, b, c, d.
  const plain = tally({ a: 1, b: 5, c: 2, d: 4 });
  ok(pick(['a', 'b', 'c', 'd'], 5, plain) === 'b', 'the fewest who cover the shortfall go: the farthest counted first, and let stay when the next alone is enough');
  ok(pick(['a', 'b', 'c', 'd'], 13, plain) === '', 'nobody goes when all of ours together would not cover it: a row no amount of ours could make room for costs none of them their place');
  ok(pick(['a', 'b', 'c', 'd'], 0, plain) === '' && chosen.length === 0, '... and nobody when nothing is short');
  const shared = tally({ a: 0, b: 0, c: 1 }, ['a', 'b'], 6);
  ok(pick(['a', 'b', 'c'], 6, shared) === 'a,b', 'two who wear one body give it back only together, and are put down together: neither alone gives anything');
  ok(pick(['a', 'b', 'c'], 7, shared) === 'a,b,c', '... and the nearer one too when the body is not enough on its own');
  const reused = tally({ a: 0, b: 0 });
  ok(pick(['a', 'b'], 1, reused) === '', 'people of ours wearing bodies the data’s own wear too give nothing back, and none of them goes for nothing');
}

console.log(`\n${checks} checks passed`);
