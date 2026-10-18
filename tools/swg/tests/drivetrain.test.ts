// The engines of a vehicle raced as a pod or a bike (src/vehicles/drivetrain.ts), on their own and through the race
// drive itself (src/vehicles/raceDrive.ts over the stand-in body and physics of raceStandIn.ts): an overheat's part
// picked uniformly and never one already burning, a fire burning a part out in its own time and stopping there, the
// pull the same either way round and of the size the design states once it reaches the stick, the boost refused while
// a part is out or burning, the repair mending the worst part first and bringing the speed down under the limp at the
// brake, its own pull toward the side repaired and the lean it holds off, a scrape's side, a bike's one engine that
// never pulls, and the heat a flow drains, only over one. Invented numbers only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ENGINE_TUNE,
  boostAllowed,
  burn,
  damagePart,
  hitSide,
  mendEngines,
  newEngineSet,
  outShare,
  overheat,
  pullOf,
  repairStep,
  sideBand,
  stepEngines,
  throttleCap,
  type EngineSet,
} from '../../../src/vehicles/drivetrain.ts';
import { RACE_TUNE } from '../../../src/vehicles/raceTune.ts';
import { boostOf } from '../../../src/vehicles/raceMath.ts';
import { standInRun } from './raceStandIn.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const r3 = (n: number) => Number(n.toFixed(3));

/** A seeded generator (mulberry32), so the rolls are the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the overheat's pick ---------------------------------------------------------------------------------------------
{
  const rand = seeded(1);
  const counts = [0, 0, 0, 0, 0, 0];
  const N = 6000;
  for (let i = 0; i < N; i++) {
    const set = newEngineSet('pod');
    counts[overheat(set, rand)]++;
  }
  const expected = N / 6;
  const chi = counts.reduce((a, c) => a + ((c - expected) * (c - expected)) / expected, 0);
  // Five degrees of freedom: 11.07 is the 5% point.
  ok(chi < 11.07, `the overheat's part over ${N} seeded rolls is uniform over the six (chi-square ${r3(chi)} under 11.07; ${counts.join(', ')})`);
  // The control: a pick that leans on one part is caught by the same test.
  const leaned = [1300, 940, 940, 940, 940, 940];
  const chiLeaned = leaned.reduce((a, c) => a + ((c - expected) * (c - expected)) / expected, 0);
  ok(chiLeaned > 11.07, `(and a pick leaning a little on one part fails it: ${r3(chiLeaned)})`);
  const one = newEngineSet('pod');
  const first = overheat(one, rand);
  ok(one.parts.filter((p) => p.fire > 0).length === 1 && one.parts[first].fire > 0, 'one overheat sets exactly one part burning');
  one.parts.forEach((p) => (p.out = p !== one.parts[0]));
  ok(overheat(one, rand) === 0 || one.parts[0].fire > 0, 'and with every other part out it is the one left that catches');
  const bike = newEngineSet('bike');
  ok(bike.parts.length === 3 && overheat(bike, rand) < 3, 'a bike picks among its one engine\'s three');
  // A part already burning cannot catch again: with five on fire, every overheat sets the sixth burning.
  let sixth = 0;
  for (let i = 0; i < 60; i++) {
    const five = newEngineSet('pod');
    for (let k = 0; k < 5; k++) five.parts[k].fire = 1;
    if (overheat(five, rand) === 5 && five.parts[5].fire > 0) sixth++;
  }
  ok(sixth === 60, `with five parts burning, every one of 60 overheats sets the sixth burning (${sixth})`);
  const all = newEngineSet('pod');
  for (const p of all.parts) p.fire = 1;
  ok(overheat(all, rand) === -1, 'and with all six burning none can catch');
}

// --- a fire ----------------------------------------------------------------------------------------------------------
{
  for (const fps of [144, 60, 20]) {
    const set = newEngineSet('pod');
    set.parts[2].fire = 1e-6;
    set.dt = 1 / fps;
    let t = 0;
    let outAt = -1;
    for (let i = 0; i < fps * 12; i++) {
      burn(set);
      t += set.dt;
      if (outAt < 0 && set.parts[2].out) outAt = t;
    }
    const want = 1 / ENGINE_TUNE.fireRate;
    ok(Math.abs(outAt - want) <= 1 / fps + 1e-9 && set.parts[2].d === 1 && set.parts[2].fire === 0, `at ${fps} fps a fire burns a whole part out in ${r3(outAt)} s (1/fireRate ${r3(want)}) and its fire goes out with it`);
    ok(set.parts.every((p, i) => i === 2 || (p.d === 0 && !p.out)), 'and nothing else burns: a fire stays in its part');
  }
}

// --- the pull --------------------------------------------------------------------------------------------------------
{
  const set = newEngineSet('pod');
  set.parts[4].d = 0.7;
  pullOf(set);
  const right = set.pull;
  const mirror = newEngineSet('pod');
  mirror.parts[1].d = 0.7;
  pullOf(mirror);
  ok(right > 0 && Object.is(mirror.pull, -right), `a damaged part on the right pulls right (${r3(right)}) and the mirrored set pulls exactly the other way`);
  const three = newEngineSet('pod');
  for (const i of [3, 4, 5]) three.parts[i].out = true;
  for (const i of [3, 4, 5]) three.parts[i].d = 1;
  pullOf(three);
  const threeL = newEngineSet('pod');
  for (const i of [0, 1, 2]) {
    threeL.parts[i].out = true;
    threeL.parts[i].d = 1;
  }
  pullOf(threeL);
  ok(Object.is(threeL.pull, -three.pull) && Math.abs(three.pull - 3 * ENGINE_TUNE.pullPart) < 1e-12, `three out on a side pull ${r3(three.pull)}, mirrored exactly`);
  const under = newEngineSet('pod');
  under.parts[4].d = ENGINE_TUNE.pullAt - 0.01;
  pullOf(under);
  ok(under.pull === 0, 'a part short of pullAt pulls nothing');
  const bike = newEngineSet('bike');
  for (const p of bike.parts) {
    p.d = 1;
    p.out = true;
  }
  pullOf(bike);
  ok(bike.pull === 0, "a bike's one engine never pulls, all three parts out");

  // Through the drive: a full pod at 100 m/s, the stick in the middle, settles at the yaw rate the squared stick gives
  // its pull -- one part about a twentieth of its full rate, three on a side about two-fifths -- and full opposite lock
  // still turns it the other way.
  const settled = (parts: number[], steer: number): number => {
    const run = standInRun('pod', 'max', 100);
    run.drive.steer = steer;
    for (const i of parts) {
      run.race.engines.parts[i].d = 1;
      run.race.engines.parts[i].out = true;
    }
    for (let i = 0; i < 120; i++) run.frame(1 / 60);
    return run.race.w / run.race.handling.maxTurn;
  };
  const one = newEngineSet('pod');
  one.parts[4].d = ENGINE_TUNE.pullAt;
  pullOf(one);
  const oneRate = (() => {
    const run = standInRun('pod', 'max', 100);
    run.race.engines.parts[4].d = ENGINE_TUNE.pullAt;
    for (let i = 0; i < 120; i++) run.frame(1 / 60);
    return run.race.w / run.race.handling.maxTurn;
  })();
  ok(Math.abs(-oneRate - one.pull * one.pull) < 0.002 && -oneRate > 0.04 && -oneRate < 0.06, `through the drive one part past pullAt turns a centred pod right at ${r3(-oneRate)} of its rate (about a twentieth)`);
  const threeRate = settled([3, 4, 5], 0);
  ok(Math.abs(-threeRate - 0.66 * 0.66) < 0.01 && -threeRate > 0.38 && -threeRate < 0.48, `and three on the right side at ${r3(-threeRate)} (about two-fifths)`);
  const lock = settled([3, 4, 5], -1);
  ok(lock > 0.05, `full opposite lock still turns it left (${r3(lock)} of its rate)`);
  const control = settled([], 0);
  ok(Math.abs(control) < 1e-9, `(and a whole pod with the stick centred does not turn: ${r3(control)})`);
}

// --- the boost refused -----------------------------------------------------------------------------------------------
{
  const boosted = (spoil: ((e: EngineSet) => void) | null): { ever: boolean; boost: number } => {
    const run = standInRun('pod', 'max', 125);
    run.drive.throttle = 1;
    run.drive.boost = true;
    if (spoil) spoil(run.race.engines);
    let ever = false;
    let boost = 0;
    for (let i = 0; i < 240; i++) {
      run.frame(1 / 60);
      if (run.race.boosting) ever = true;
      boost = Math.max(boost, boostOf(run.race.B, run.race.handling.BT, RACE_TUNE.boostHalf));
      // A fire is kept burning (it would otherwise burn its part out in eight seconds: out refuses it as well).
      if (spoil && run.race.engines.parts[0].fire > 0) run.race.engines.parts[0].d = 0.1;
    }
    return { ever, boost };
  };
  const whole = boosted(null);
  ok(whole.ever && whole.boost > 10, `a whole pod at speed with Shift and W boosts (${r3(whole.boost)} m/s of it)`);
  const out = boosted((e) => {
    e.parts[3].d = 1;
    e.parts[3].out = true;
  });
  ok(!out.ever && out.boost === 0, 'with a part out the boost is refused');
  const burning = boosted((e) => {
    e.parts[0].fire = 1e-6;
  });
  ok(!burning.ever && burning.boost === 0, 'and with a part burning');
  const set = newEngineSet('pod');
  ok(boostAllowed(set), 'boostAllowed: whole');
  set.parts[5].fire = 0.5;
  ok(!boostAllowed(set), 'boostAllowed: a part burning refuses');
}

// --- the repair ------------------------------------------------------------------------------------------------------
{
  // The pure step: nothing under repairHold; then the worst part first, at the rate, its fire out at once, an out part back once under whole.
  const set = newEngineSet('pod');
  set.parts[1].d = 0.4;
  set.parts[4].d = 1;
  set.parts[4].out = true;
  set.parts[2].fire = 3;
  set.parts[2].d = 0.2;
  set.wantRepair = true;
  set.rate = 0.1;
  set.dt = 0.1;
  for (let i = 0; i < 3; i++) repairStep(set);
  ok(set.repairing === -1 && set.parts[4].out && set.parts[2].fire > 0, `held ${r3(set.held)} s (under repairHold ${ENGINE_TUNE.repairHold}) nothing is mended yet`);
  repairStep(set);
  ok(set.repairing === 4 && !set.parts[4].out && Math.abs(set.parts[4].d - 0.99) < 1e-9, 'past it the worst part first, the out one, brought back the moment it is under whole');
  for (let i = 0; i < 5; i++) repairStep(set);
  ok(Math.abs(set.parts[4].d - 0.94) < 1e-9, `mended at the rate (${r3(set.parts[4].d)} after six steps of 0.1 s at 0.1 a second)`);
  const fire = newEngineSet('pod');
  fire.parts[2].fire = 3;
  fire.parts[2].d = 0.2;
  fire.wantRepair = true;
  fire.held = 1;
  fire.dt = 0.1;
  fire.rate = 0.1;
  repairStep(fire);
  ok(fire.repairing === 2 && fire.parts[2].fire === 0, 'a burning part repaired has its fire put out at once');
  set.wantRepair = false;
  repairStep(set);
  ok(set.held === 0 && set.repairing === -1, 'let go, it starts again from nought');
  const whole = newEngineSet('pod');
  whole.wantRepair = true;
  whole.held = 5;
  whole.dt = 0.1;
  stepEngines(whole);
  ok(whole.repairing === -1 && !whole.limp && whole.top === 1, 'with nothing to mend nothing is repaired, and it costs nothing');

  // Through the drive at a full pod's plain top: a part out on the left, R held. The speed comes down under the limp's
  // share of the plain top at the brake, never in a step, and the part comes back.
  for (const fps of [144, 60, 20]) {
    const run = standInRun('pod', 'max', 100);
    run.drive.throttle = 1;
    for (let i = 0; i < 20 * fps; i++) run.frame(1 / fps);
    const plain = run.race.plainTop();
    const p = run.race.engines.parts[0];
    p.d = 1;
    p.out = true;
    // Every other part well worn, so the repair is still under way when the eight seconds are up.
    for (let i = 1; i < 6; i++) run.race.engines.parts[i].d = 0.95;
    run.frame(1 / fps);
    const before = run.race.h;
    run.drive.repair = true;
    let worstDrop = 0;
    let last = run.race.h;
    let repairingAt = -1;
    let t = 0;
    for (let i = 0; i < 8 * fps; i++) {
      run.frame(1 / fps);
      t += 1 / fps;
      if (repairingAt < 0 && run.race.engines.repairing >= 0) repairingAt = t;
      worstDrop = Math.max(worstDrop, last - run.race.h);
      last = run.race.h;
    }
    const limpTop = ENGINE_TUNE.limp * (plain / 1);
    const brakeDrop = (before / run.race.handling.brake) * (1 / fps) * 1.05 + 1e-6;
    ok(Math.abs(repairingAt - ENGINE_TUNE.repairHold) <= 1 / fps + 1e-9, `at ${fps} fps the repair begins after ${r3(repairingAt)} s held (repairHold ${ENGINE_TUNE.repairHold})`);
    ok(run.race.h <= limpTop + 0.5 && worstDrop <= brakeDrop, `and the pod comes down from ${r3(before)} m/s to ${r3(run.race.h)} (under the limp's ${r3(limpTop)}), never faster than the brake allows (worst ${r3(worstDrop)} a frame, brake ${r3(brakeDrop)})`);
    ok(!p.out && p.d < 0.95 && run.race.engines.repairing >= 0, `and the part that was out is back (${r3(p.d)}), the repair going on to the next worst`);
    run.drive.repair = false;
    for (let i = 0; i < 30 * fps; i++) run.frame(1 / fps);
    ok(run.race.engines.top === outShare(run.race.engines) && run.race.h > limpTop + 5, `let go, the limp is lifted and the pod climbs again (${r3(run.race.h)} m/s)`);
  }

  // The repair felt in the hands, through the drive: a stock pod at 100 m/s, the stick in the middle, a part under
  // pullAt (so the damage pulls nothing) held for repair. It settles at the yaw rate the squared repairPull gives,
  // toward the side repaired (the right turns it right, w below nought), mirrored for the left; and nothing at all
  // without the key, so what turns it is the repair and nothing else.
  const repairTurn = (part: number, repair: boolean): { rate: number; repairing: number } => {
    const run = standInRun('pod', 'stock', 100);
    run.race.engines.parts[part].d = ENGINE_TUNE.pullAt - 0.05;
    run.drive.repair = repair;
    for (let i = 0; i < 150; i++) run.frame(1 / 60);
    return { rate: run.race.w / run.race.handling.maxTurn, repairing: run.race.engines.repairing };
  };
  const want = ENGINE_TUNE.repairPull * ENGINE_TUNE.repairPull;
  const right = repairTurn(4, true);
  const left = repairTurn(1, true);
  ok(right.repairing === 4 && Math.abs(-right.rate - want) < 0.002 && right.rate < 0, `holding the repair on a right part turns a centred pod right at ${r3(-right.rate)} of its rate (repairPull squared, ${r3(want)})`);
  ok(left.repairing === 1 && Math.abs(left.rate - want) < 0.002, `and on a left part, left at ${r3(left.rate)}`);
  ok(Math.abs(repairTurn(4, false).rate) < 1e-9, '(and the same pod with nothing held does not turn)');

  // The lean held off while a part is repaired: the pilot's hands are full. The control leans over on the same keys.
  const leaned = (repair: boolean): number => {
    const run = standInRun('pod', 'stock', 100);
    run.race.engines.parts[4].d = ENGINE_TUNE.pullAt - 0.05;
    run.drive.lean = 1;
    run.drive.repair = repair;
    for (let i = 0; i < 150; i++) run.frame(1 / 60);
    return run.race.lean;
  };
  const busy = leaned(true);
  const free = leaned(false);
  ok(Math.abs(busy) < 0.01 && free > 0.9, `leaning while repairing leaves the lean at ${r3(busy)}, where the same keys alone lean it to ${r3(free)}`);

  // The game's own key, by its text: read only inside the race branch (a pod, or a bike in racing mode, the drive
  // holding it) and only with nothing in the placing hand, which R turns; written nowhere else.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const open = main.indexOf('if (race && race.wants(pilot)) {');
  const line = main.indexOf("drive.repair = input.held('repair') && !this.placing && !this.propPlacing;");
  let depth = 0;
  let inside = open > 0 && line > open;
  for (let i = open + 'if (race && race.wants(pilot)) '.length; inside && i < line; i++) {
    if (main[i] === '{') depth++;
    else if (main[i] === '}' && --depth === 0) inside = false;
  }
  ok(inside && main.split('drive.repair =').length === 2, "(main.ts: the repair key is read inside the race branch alone, with the placing hand empty)");
}

// --- the heat over a flow --------------------------------------------------------------------------------------------
{
  // Through the drive, engines warm (heat 60 of 100) and no boost, two seconds: over a flow the engines lose lavaHeat a
  // second on top of what they would have cooled by; a flow asked of a column with no liquid over its ground drains
  // nothing, which is the lava world's whole planet (its sea a flow under dry ground everywhere).
  let wet = false;
  const heatAfter = (water: ((x: number, z: number) => number) | null, lava: ((x: number, z: number) => boolean) | null): number => {
    const run = standInRun('pod', 'stock', 75, { water, lava });
    run.race.heat = 60;
    for (let i = 0; i < 120; i++) run.frame(1 / 60);
    wet = run.vehicle.onWater;
    return run.race.heat;
  };
  const always = () => true;
  const never = () => false;
  const plain = heatAfter(null, null);
  const dry = heatAfter(() => -Infinity, always);
  const dryWet = wet;
  const under = heatAfter(() => -5, always);
  const underWet = wet;
  const flowing = heatAfter(() => 0.3, always);
  const water = heatAfter(() => 0.3, never);
  // What tells the drive the liquid stands over the ground at all is the hull's own word that it is on water.
  ok(wet && !dryWet && !underWet, `over liquid standing on the ground the hull says it is on water (${wet}), over dry ground and over a flow under it, not`);
  ok(plain > 60 && Object.is(dry, plain), `over dry ground whose column answers "a flow" the heat is exactly what it is with no flow at all (${r3(dry)})`);
  ok(Object.is(under, plain), `and over a flow standing under the ground, the same (${r3(under)})`);
  ok(Object.is(water, plain), `over plain water, the same (${r3(water)})`);
  const lost = water - flowing;
  ok(Math.abs(lost - ENGINE_TUNE.lavaHeat * 2) < ENGINE_TUNE.lavaHeat * 0.05, `over a flow the engines lose ${r3(lost)} of their coolness in two seconds more than over water (lavaHeat ${ENGINE_TUNE.lavaHeat} a second)`);
}

// --- the side a scrape lands on ----------------------------------------------------------------------------------------
{
  const rand = seeded(3);
  // The pilot's right at heading nought is -x: a loss pointing that way is the right engine.
  ok(hitSide(-5, 0, -1, 0, rand) === 1 && hitSide(5, 0, -1, 0, rand) === 0, 'a loss toward the right is the right engine, toward the left the left');
  const set = newEngineSet('pod');
  for (let i = 0; i < 40; i++) damagePart(set, 1, 0.01, rand);
  ok(set.parts.slice(0, 3).every((p) => p.d === 0) && set.parts.slice(3).some((p) => p.d > 0), 'and its damage lands on that side alone');
  const bike = newEngineSet('bike');
  damagePart(bike, 1, 0.3, rand);
  ok(bike.parts.some((p) => p.d === 0.3), "a bike's one engine takes it whatever the side");
}

// --- the top's share and the limp, the bands ---------------------------------------------------------------------------
{
  const set = newEngineSet('pod');
  set.parts[0].out = true;
  set.parts[0].d = 1;
  set.dt = 0.01;
  stepEngines(set);
  ok(Math.abs(set.top - (1 - ENGINE_TUNE.outTopPod)) < 1e-12 && !set.limp, `a part out takes outTop off the top (${r3(set.top)})`);
  for (const i of [1, 2]) {
    set.parts[i].out = true;
    set.parts[i].d = 1;
  }
  stepEngines(set);
  ok(set.top === ENGINE_TUNE.limp && set.limp && throttleCap(set) === ENGINE_TUNE.limp, 'a side with all three out holds it at the limp');
  const bike = newEngineSet('bike');
  bike.parts[0].out = true;
  bike.parts[0].d = 1;
  bike.dt = 0.01;
  stepEngines(bike);
  ok(Math.abs(bike.top - (1 - ENGINE_TUNE.outTopBike)) < 1e-12, "a bike's part out takes the bike's larger share");
  const b = newEngineSet('pod');
  b.parts[3].d = 0.3;
  ok(sideBand(b, 1) === 1 && sideBand(b, 0) === 0, 'light smoke on a side from a quarter');
  b.parts[4].fire = 1;
  ok(sideBand(b, 1) === 2, 'burning while a part of it is on fire');
  b.parts[5].d = 0.8;
  ok(sideBand(b, 1) === 3, 'heavy smoke from three-quarters');
  mendEngines(b);
  ok(b.parts.every((p) => p.d === 0 && p.fire === 0 && !p.out), 'mended, every part whole');
}

console.log(`\ndrivetrain: ${checks} checks passed`);
