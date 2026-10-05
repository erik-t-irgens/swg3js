// A nebula's arithmetic, checked without a browser: how many sheets a row asks for and how the
// zone's cap shares them out, that the same nebula makes the same sheets every time and in every
// browser, that a sheet's colour runs from the row's colour at the middle to its ramp colour at the
// edge, that pulling a far nebula toward the camera leaves its picture exactly the size it was,
// that two browsers on the same wall clock find the same strikes at the same moments however
// differently their frames fall and that they strike as often and where the game's rule says, that a
// long gap never becomes a burst, that a tick which does not strike makes nothing, that a strike
// drains one shield and nothing under it and a ship rests between strikes, what a nebula does to a
// ship's systems and what the message line says of it, how many strike records a zone keeps, that
// every ship a bolt passes is struck at its nearest point whether or not the bolt is drawn, and that
// the camera shake stays inside its numbers.
//
// Every nebula here is made up. The last section reads the owner's converted zones when they are
// there and prints only a pass or a fail: no value out of a pack is written down anywhere.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { constants as perfConstants, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import * as THREE from 'three';
import { viewShakeAmount } from '../../../src/core/camera.ts';
import { Nebulae, type NebulaShip } from '../../../src/space/nebulae.ts';
import {
  NEBULA_SYSTEMS,
  NEBULA_TUNE,
  NebulaNote,
  SYSTEM_CLAMPS,
  apparentSize,
  beamCurves,
  beamEnvelope,
  buildSheets,
  clampOpacity,
  deepestInside,
  dimInside,
  insideDepth,
  nebulaNotice,
  nebulaSystemsAt,
  newNebulaSystems,
  newStrike,
  seenDepth,
  segmentReach,
  pullScale,
  rampAt,
  rowStrikes,
  seedOfName,
  shakeAt,
  shareSheets,
  sheetCount,
  shipSystemsAt,
  sortFarToNear,
  strikeDamage,
  strikeOfTick,
  strikeRecords,
  strikesBetween,
  systemFactors,
  tickMs,
  tickOf,
  waveAt,
  weakened,
  type InsideAt,
  type NebulaStrike,
  type NebulaSystems,
  type SegmentReach,
  type SystemFactors,
  type ViewShake,
} from '../../../src/space/nebulaMath.ts';
import type { Nebula, NebulaColour, SpacePack } from '../../../src/space/spaceData.ts';
import { ShipCombat } from '../../../src/space/shipCombat.ts';
import { applyShieldHit, createCondition, newHitResult } from '../../../src/space/shipDamage.ts';
import { statsFor, type StatInput } from '../../../src/space/shipStats.ts';
import type { CombatFile } from '../../../src/space/combatData.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** A made-up row, in the shape the pack gives one. */
const row = (name: string, at: [number, number, number], radius: number, extra: Partial<Nebula> = {}): Nebula => ({
  name,
  at,
  radius,
  density: 1,
  facingShare: 0.5,
  facing: { colour: [0.6, 1, 0.8, 0.8] as NebulaColour, ramp: [0.2, 0.4, 0.6, 1] as NebulaColour },
  oriented: { colour: [0.5, 1, 1, 1] as NebulaColour, ramp: [0.5, 1, 1, 1] as NebulaColour },
  jitter: 0,
  shader: 'mist',
  shaderIndex: 1,
  sound: { ambient: null, volume: 0 },
  lightning: null,
  unused: {},
  ...extra,
});

// --- 1. how many sheets, and the zone's cap ---

{
  const small = sheetCount(200, 1, NEBULA_TUNE);
  const big = sheetCount(6000, 1, NEBULA_TUNE);
  ok(small >= NEBULA_TUNE.sheetsMin && big <= NEBULA_TUNE.sheetsMax, 'a nebula asks for at least the floor and never more than the ceiling');
  ok(sheetCount(1500, 1, NEBULA_TUNE) >= sheetCount(1500, 0.4, NEBULA_TUNE), 'a thinner nebula asks for no more sheets than a thick one of the same size');
  ok(sheetCount(3000, 1, NEBULA_TUNE) >= sheetCount(600, 1, NEBULA_TUNE), 'a larger nebula asks for at least as many as a small one');

  const wanted = [90, 90, 90, 90, 90];
  const same = shareSheets(wanted, 1000);
  ok(same.join() === wanted.join(), 'a zone under the cap keeps every sheet it asked for');
  const cut = shareSheets(wanted, 100);
  ok(
    cut.reduce((a, b) => a + b, 0) <= 120 && cut.every((c) => c >= 3),
    'a zone over the cap is shared down in proportion and no nebula is left without sheets',
  );
  const lopsided = shareSheets([300, 30], 110);
  ok(lopsided[0] > lopsided[1], 'the share keeps the big nebula bigger than the small one');
}

// --- 2. the same sheets every time ---

{
  const r = row('a made up nebula', [1000, -200, 500], 2000);
  const once = buildSheets(r, 0, 20, NEBULA_TUNE);
  const twice = buildSheets(r, 0, 20, NEBULA_TUNE);
  ok(once.length === 20 && twice.length === 20, 'a nebula makes the sheets it was asked for');
  ok(JSON.stringify(once) === JSON.stringify(twice), 'the same nebula makes exactly the same sheets every time, so two browsers draw one cloud');
  const other = buildSheets(row('another made up nebula', [1000, -200, 500], 2000), 0, 20, NEBULA_TUNE);
  ok(JSON.stringify(other) !== JSON.stringify(once), 'two nebulae with the same place and size are still two different clouds');
  ok(seedOfName('a') !== seedOfName('b'), 'two names are two seeds');

  const inside = once.every((s) => Math.hypot(s.x - r.at[0], s.y - r.at[1], s.z - r.at[2]) <= r.radius + 1e-6);
  ok(inside, 'every sheet stands inside its nebula');
  ok(
    once.every((s) => s.size >= r.radius * NEBULA_TUNE.sizeMin - 1e-6 && s.size <= r.radius * NEBULA_TUNE.sizeMax + 1e-6),
    'every sheet is between the smallest and the largest share of the radius',
  );
  ok(
    once.every((s) => near(Math.hypot(...s.right), 1, 1e-6) && near(Math.hypot(...s.up), 1, 1e-6) && near(s.right[0] * s.up[0] + s.right[1] * s.up[1] + s.right[2] * s.up[2], 0, 1e-6)),
    'a sheet that keeps its turn has two unit axes at right angles, so it is never stretched',
  );
  const facing = once.filter((s) => s.facing).length;
  ok(facing > 2 && facing < 18, 'about half of them turn to face the camera, as the row asks');
  const half = buildSheets(r, 0, 10, NEBULA_TUNE);
  ok(JSON.stringify(half) === JSON.stringify(once.slice(0, 10)), 'asking for fewer sheets keeps the ones it had, so moving the density knob does not shuffle the cloud');
}

// --- 3. the colour from the middle to the edge ---

{
  const colour: NebulaColour = [0.5, 1, 0, 0];
  const ramp: NebulaColour = [0.25, 0, 0, 1];
  const middle = rampAt(colour, ramp, 0);
  const edge = rampAt(colour, ramp, 1);
  const half = rampAt(colour, ramp, 0.5);
  ok(middle[0] === 1 && middle[3] === 0.5, 'at the middle a sheet wears the row\'s own colour, alpha and all');
  ok(edge[2] === 1 && edge[3] === 0.25, 'at the edge it wears the ramp colour');
  ok(near(half[0], 0.5, 1e-9) && near(half[3], 0.375, 1e-9), 'and it runs straight between them on the way out');
}

// --- 4. pulling a far nebula in ---

{
  const far = 14000;
  const k = pullScale(far, NEBULA_TUNE);
  ok(k < 1 && near(far * k, NEBULA_TUNE.pullFrom, 1e-6), 'a nebula past the pull distance is brought exactly to it');
  ok(pullScale(NEBULA_TUNE.pullFrom - 1, NEBULA_TUNE) === 1, 'a nebula this side of it is left alone');
  // A sheet 3 km off the middle of a nebula 14 km away, scaled about the camera by the same ratio.
  const sheetDistance = far + 3000;
  const size = 2500;
  const before = apparentSize(size, sheetDistance);
  const after = apparentSize(size * k, sheetDistance * k);
  ok(near(before, after, 1e-12), 'scaling a whole nebula about the camera leaves every sheet exactly the size it looked');
}

// --- 5. how deep inside ---

{
  ok(insideDepth(1000, 1000, NEBULA_TUNE) === 0, 'at the edge the camera is not inside at all');
  ok(insideDepth(0, 1000, NEBULA_TUNE) === 1, 'at the middle it is all the way in');
  const part = insideDepth(900, 1000, NEBULA_TUNE);
  ok(part > 0 && part < 1, 'just inside the edge it is a little way in');
  ok(insideDepth(1500, 1000, NEBULA_TUNE) === 0, 'outside it is not inside at all');

  const rows = [row('thin', [0, 0, 0], 1000, { density: 0.2 }), row('thick', [0, 0, 400], 1000, { density: 1 })];
  const deep = deepestInside(rows, 0, 0, 200, NEBULA_TUNE);
  ok(deep.index === 1, 'where two nebulae overlap, the thicker one is the one the camera is in');
  ok(deepestInside(rows, 0, 0, 9000, NEBULA_TUNE).index === -1, 'and outside them all there is none');

  // It is asked once a frame, so it writes into an object it is given rather than making one.
  const where: InsideAt = { index: 7, depth: 7 };
  const back = deepestInside(rows, 0, 0, 200, NEBULA_TUNE, where);
  ok(back === where && where.index === 1 && where.depth > 0, 'where the camera is inside is written into the object it is handed, so a frame makes nothing');
  deepestInside(rows, 0, 0, 9000, NEBULA_TUNE, where);
  ok(where.index === -1 && where.depth === 0, 'and the same object is cleared when the camera comes out, never left saying the old answer');

  ok(near(dimInside(0, 0.85), 1, 1e-9), 'outside a nebula the flare and the rays are untouched');
  ok(near(dimInside(1, 0.85), 0.15, 1e-9), 'deep inside one they are dimmed by the share they are given');
}

// --- 6. the strikes, on the wall clock, by the game's rule ---

{
  const seed = seedOfName('a made up nebula');
  const every = 0.5;
  const maxSeconds = 2;
  const radius = 1500;
  const from = 1_700_000_000_000;
  const to = from + 60_000;
  const cube = radius * NEBULA_TUNE.strikeCube;

  // One browser polling sixty times a second, another seven times: both must find the same strikes.
  // The two steps are not whole milliseconds, which is what a real frame clock hands over.
  const scratch: NebulaStrike[] = [];
  const poll = (step: number): NebulaStrike[] => {
    const found: NebulaStrike[] = [];
    for (let t = from; t < to; t += step) found.push(...strikesBetween(seed, every, maxSeconds, radius, t, Math.min(to, t + step), scratch, NEBULA_TUNE));
    return found;
  };
  const fast = poll(1000 / 60);
  const slow = poll(1000 / 7);
  ok(slow.length > 0, 'a nebula that strikes every two seconds strikes in a minute');
  ok(
    slow.length === fast.length && slow.every((s, i) => s.tick === fast[i].tick && s.at === fast[i].at && s.from.join() === fast[i].from.join() && s.to.join() === fast[i].to.join() && s.roll === fast[i].roll),
    'two browsers polling at a sixtieth and a seventh of a second find exactly the same strikes, at the same moments, in the same places',
  );
  ok(new Set(slow.map((s) => s.tick)).size === slow.length, 'a strike is never started twice');
  ok(
    slow.every((s) => [...s.from, ...s.to].every((v) => Math.abs(v) <= cube + 1e-9)),
    "every bolt's two ends lie in the cube three tenths of the radius either side of the middle (the game's rule)",
  );
  ok(
    slow.some((s) => Math.abs(s.from[0]) > cube * 0.5) && slow.some((s) => Math.abs(s.to[2]) > cube * 0.5),
    'and they reach out into the whole of that cube, not just its middle',
  );
  ok(
    slow.every((s) => s.seconds >= maxSeconds * 0.5 - 1e-9 && s.seconds <= maxSeconds + 1e-9),
    "a strike lasts half to all of the row's longest (the game's rule)",
  );
  ok(slow.every((s) => s.at % tickMs(NEBULA_TUNE) === 0 && s.at > from && s.at <= to), 'every strike begins on a tick of the wall clock, inside the window it was asked for');

  // How often: an hour of ticks at a fifth of a strike a second is 720 strikes. One hour of one
  // nebula is 720 draws of a two-in-a-hundred chance, a spread of about 27 either way, so the rate is
  // held to five per cent over ten nebulae's hours (a spread of about 1.2%) and each hour to fifteen.
  {
    const perHour: number[] = [];
    const first = tickOf(from, NEBULA_TUNE);
    const ticks = Math.round(3600 / NEBULA_TUNE.strikeTick);
    const one = newStrike();
    for (let k = 0; k < 10; k++) {
      const s = seedOfName(`a made up nebula ${k}`);
      let n = 0;
      for (let t = first; t < first + ticks; t++) if (strikeOfTick(s, t, 0.2, 2, 1000, NEBULA_TUNE, one)) n++;
      perHour.push(n);
    }
    const mean = perHour.reduce((a, b) => a + b, 0) / perHour.length;
    ok(Math.abs(mean - 720) <= 36, `a nebula that strikes a fifth of a time a second strikes 720 times an hour, give or take five per cent (${mean.toFixed(1)} over ten nebulae)`);
    ok(perHour.every((n) => Math.abs(n - 720) <= 108), `and no one nebula's hour is far from it (${perHour.join(', ')})`);
    // And the same hour asked the way the game asks for it, a window at a time through `strikesBetween`
    // (a quarter of a second, inside the catch-up), which must come to exactly the ticks above: the
    // rate is the path the game polls, not only the tick it is built from.
    const polled: number[] = [];
    const found: NebulaStrike[] = [];
    const window = 250;
    for (let k = 0; k < 10; k++) {
      const s = seedOfName(`a made up nebula ${k}`);
      let n = 0;
      const start = first * tickMs(NEBULA_TUNE) - 1;
      for (let t = start; t < start + 3_600_000; t += window) n += strikesBetween(s, 0.2, 2, 1000, t, t + window, found, NEBULA_TUNE).length;
      polled.push(n);
    }
    const polledMean = polled.reduce((a, b) => a + b, 0) / polled.length;
    ok(Math.abs(polledMean - 720) <= 36 && polled.every((n, k) => n === perHour[k]), `polled a quarter of a second at a time, the same ten hours come to the same strikes, tick for tick (${polledMean.toFixed(1)})`);
  }
  // The game's cap on the chance in one moment: a rate of ten a second still strikes at most every other tick.
  {
    const one = newStrike();
    let n = 0;
    const first = tickOf(from, NEBULA_TUNE);
    for (let t = first; t < first + 10000; t++) if (strikeOfTick(seed, t, 10, 2, 1000, NEBULA_TUNE, one)) n++;
    ok(Math.abs(n / 10000 - NEBULA_TUNE.strikeChanceCap) < 0.03, `a nebula striking faster than the cap is held to its chance in a tick (${n} in 10000)`);
  }

  const nothing = strikesBetween(seed, 0, maxSeconds, radius, from, to, scratch, NEBULA_TUNE);
  ok(nothing.length === 0, 'a row with no strike rate never strikes');

  // A tab that was away for an hour must not catch up with an hour of lightning.
  const caught = strikesBetween(seed, 1, maxSeconds, radius, from, from + 3_600_000, scratch, NEBULA_TUNE);
  const most = Math.floor((NEBULA_TUNE.catchUpSeconds * 1000) / tickMs(NEBULA_TUNE));
  ok(caught.length <= most && caught.every((s) => s.at > from + 3_600_000 - NEBULA_TUNE.catchUpSeconds * 1000), 'a long gap comes back with no more than its last half second, never with a burst');

  // A tick that does not strike makes nothing at all. Measured the way the rule reads, by what the
  // ticks make and not by what survives a collection: the young generation's use before and after
  // with no collection in between, and how many collections of it ran meanwhile (any at all means
  // more was made than it holds). It is measured over a million ticks in two hundred long windows,
  // warmed first so what is measured is the optimised code a session runs: whatever a single call
  // costs the engine to hand its numbers over (a few bytes, and how many depends on what the engine
  // has seen before, which is the test's and not the clock's) is then nothing beside a million ticks,
  // while one object a tick, or a list of them a call, is megabytes. Their moments are real
  // wall-clock milliseconds, made before the measuring starts. The engine can still be part way
  // through optimising the loop while a run is measured, and the unoptimised code it falls back on
  // meanwhile boxes its numbers as it goes, so the run is made up to three times and the cleanest
  // counts: a real allocation is in every one of them, a passing compile is in one at most.
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    const quiet = seedOfName('a quiet nebula');
    const polls = 200;
    const warm = 40;
    const ticksEach = 5000;
    const windowMs = ticksEach * tickMs(NEBULA_TUNE);
    // A list that holds a word first keeps every number put in it after as a boxed number of its own.
    const stamps: unknown[] = ['moments'];
    stamps.length = 0;
    for (let i = 0; i <= warm + polls; i++) stamps.push(from + i * windowMs);
    // A rate so low that a million ticks strike about never, and the windows asked for whole.
    const poll = (i: number): void => {
      strikesBetween(quiet, 1e-7, 2, 1000, stamps[i] as number, stamps[i + 1] as number, scratch, NEBULA_TUNE, windowMs / 1000 + 1);
    };
    for (let i = 0; i < warm; i++) poll(i);
    let scavenges = 0;
    const watch = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
    });
    watch.observe({ entryTypes: ['gc'] });
    const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      gc();
      await new Promise((r) => setImmediate(r));
      scavenges = 0;
      const before = young();
      for (let i = 0; i < polls; i++) poll(warm + i);
      const made = young() - before;
      await new Promise((r) => setImmediate(r));
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made < 64 * 1024) break;
    }
    watch.disconnect();
    ok(best.scavenges === 0 && best.made < 64 * 1024, `a million ticks of a nebula that does not strike make nothing (${Math.max(0, best.made)} bytes over ${polls * ticksEach} ticks, ${best.scavenges} collections of the young generation)`);
  } else console.log('skip a million ticks of a nebula that does not strike make nothing: run with node --expose-gc to measure');
}

// --- 6b. the nearest point on a bolt, and the systems a nebula weakens ---

{
  const at: SegmentReach = { x: 0, y: 0, z: 0, t: 0, distance: 0 };
  ok(near(segmentReach(0, 0, 0, 10, 0, 0, 5, 3, 0, at), 3, 1e-12) && near(at.x, 5, 1e-12) && near(at.t, 0.5, 1e-12), 'the nearest point on a bolt to a ship beside its middle is straight across from it');
  ok(near(segmentReach(0, 0, 0, 10, 0, 0, -4, 3, 0, at), 5, 1e-12) && at.x === 0 && at.t === 0, 'past one end it is that end');
  ok(near(segmentReach(0, 0, 0, 10, 0, 0, 13, 4, 0, at), 5, 1e-12) && at.x === 10 && at.t === 1, 'and past the other, the other');
  ok(near(segmentReach(2, 2, 2, 2, 2, 2, 2, 2, 5, at), 3, 1e-12) && at.z === 2, 'a bolt of no length is its one point');
  ok(near(segmentReach(0, -50, 0, 0, 50, 0, 7, 0, 7, at), Math.hypot(7, 7), 1e-9), 'and the distance is the whole of the way off, not one axis of it');

  const systems: NebulaSystems = newNebulaSystems();
  // Two rows that set their own effects, as the game's table could: summed, then held (READ).
  const stormy = { effectEngine: -0.3, effectReactor: -0.4, effectShields: -1.5 };
  const thick = row('thick', [0, 0, 0], 1000, { density: 0.5, unused: stormy });
  const thicker = row('thicker', [500, 0, 0], 1000, { density: 0.5, unused: stormy });
  nebulaSystemsAt([thick, thicker], 250, 0, 0, systems);
  ok(systems.inside === 2, 'a ship where two nebulae overlap is held by both');
  ok(systems.shields === SYSTEM_CLAMPS.shields[0] && SYSTEM_CLAMPS.shields[0] === -2, "their own effects are summed, and a shield effect of -3 is held at -2 (the game's clamp)");
  ok(systems.engine === SYSTEM_CLAMPS.engine[0] && systems.reactor === SYSTEM_CLAMPS.reactor[0] && SYSTEM_CLAMPS.engine[0] === -0.5, 'and the engine and the reactor, at -0.6 and -0.8, at -0.5, theirs');
  nebulaSystemsAt([thick, thicker], -900, 0, 0, systems);
  ok(systems.inside === 1 && near(systems.engine, -0.3, 1e-12) && near(systems.reactor, -0.4, 1e-12) && near(systems.shields, -1.5, 1e-12), "in one of them only, it takes that one's");
  nebulaSystemsAt([thick, thicker], 5000, 0, 0, systems);
  ok(systems.inside === 0 && systems.engine === 0 && systems.reactor === 0 && systems.shields === 0, 'outside them all there is nothing at all');
  // Rows that set nothing, as every retail row: ours, once, from the densest of them.
  const core = row('core', [0, 0, 0], 300, { density: 0.8 });
  const body = row('body', [0, 0, 0], 800, { density: 0.5 });
  const shell = row('shell', [0, 0, 0], 1300, { density: 0.3 });
  nebulaSystemsAt([core, body, shell], 100, 0, 0, systems);
  ok(
    systems.inside === 3 && near(systems.engine, NEBULA_SYSTEMS.engine * 0.8, 1e-12) && near(systems.reactor, NEBULA_SYSTEMS.reactor * 0.8, 1e-12) && near(systems.shields, NEBULA_SYSTEMS.shields * 0.8, 1e-12),
    "in the middle of a cloud the game layered out of three rows, ours is taken once, from the densest, not three times over",
  );
  nebulaSystemsAt([core, body, shell], 1000, 0, 0, systems);
  ok(systems.inside === 1 && near(systems.shields, NEBULA_SYSTEMS.shields * 0.3, 1e-12), 'and in its thin outer shell, from the shell');
  const own = row('its own', [0, 0, 0], 1000, { density: 0.5, unused: { effectEngine: 0.3, effectReactor: 0, effectShields: 0 } });
  nebulaSystemsAt([own], 0, 0, 0, systems);
  ok(near(systems.engine, 0.3, 1e-12) && near(systems.reactor, NEBULA_SYSTEMS.reactor * 0.5, 1e-12), "a row's own effect, where the table set one, is taken over ours; a column it left at nothing takes ours");
  nebulaSystemsAt([own, body], 0, 0, 0, systems);
  ok(near(systems.engine, 0.3 + NEBULA_SYSTEMS.engine * 0.5, 1e-12), "and a row's own effect is summed with ours from the rows that set none");

  const factors: SystemFactors = { engine: 1, reactor: 1, shields: 1 };
  nebulaSystemsAt([row('half', [0, 0, 0], 1000, { density: 0.5 })], 0, 0, 0, systems);
  systemFactors(systems, factors);
  ok(near(factors.engine, 0.95, 1e-12) && near(factors.reactor, 0.81, 1e-12) && near(factors.shields, 0.5625, 1e-12), `at a density of a half the engines run at 95%, the reactor at 81% and the shields' own recharge at 56.25% (${factors.engine}, ${factors.reactor}, ${factors.shields})`);
  systemFactors({ engine: 0, reactor: 0, shields: 0 }, factors);
  ok(factors.engine === 1 && factors.reactor === 1 && factors.shields === 1, 'and outside every nebula each is exactly one');
  systemFactors({ engine: -2, reactor: 0.5, shields: -2 }, factors);
  ok(factors.engine === SYSTEM_CLAMPS.efficiency[0] && factors.reactor === 1 && factors.shields === 0, 'an efficiency never goes under a tenth, the reactor never over its rating, and a shield effect of -2 stops the recharge');
  const said = nebulaNotice({ engine: 0.95, reactor: 0.81, shields: 0.5625 });
  ok(/engines at 95%/.test(said) && /reactor at 81%/.test(said) && /shield recharge at 46%/.test(said), `the message line names the three shares, the shields' as they really come back (${said})`);

  // One ship's record, as the ship contacts work it out each step: nothing for a hull in a jump or
  // held where it is, whatever nebula it stands in.
  const cloud = [row('half', [0, 0, 0], 1000, { density: 0.5 })];
  const hull = { ghosted: false, held: false, pos: { x: 0, y: 0, z: 0 } };
  const rec = newNebulaSystems();
  shipSystemsAt(cloud, hull, rec);
  ok(rec.inside === 1 && rec.engine < 0 && rec.shields < 0, 'a ship flying inside a nebula is weighed on');
  hull.ghosted = true;
  shipSystemsAt(cloud, hull, rec);
  ok(rec.inside === 0 && rec.engine === 0 && rec.reactor === 0 && rec.shields === 0, 'a hull in a jump (ghosted) is weighed on by nothing, so a jump through a nebula does nothing to it');
  hull.ghosted = false;
  hull.held = true;
  shipSystemsAt(cloud, hull, rec);
  ok(rec.inside === 0 && rec.engine === 0 && rec.shields === 0, 'nor is a hull held where it is');
  hull.held = false;
  shipSystemsAt([], hull, rec);
  ok(rec.inside === 0 && rec.engine === 0, 'and off a space zone, with no nebulae at all, nothing is');

  // The message line: once on the way in, never while the ship stays in, nothing on the way out, and
  // news again for the next ship flown in after a step in which nobody flew one.
  const note = new NebulaNote();
  const inside: SystemFactors = { engine: 0.95, reactor: 0.81, shields: 0.5625 };
  const outside: SystemFactors = { engine: 1, reactor: 1, shields: 1 };
  const said1 = note.player(inside);
  note.endStep();
  const said2 = note.player(inside);
  note.endStep();
  ok(said1 === nebulaNotice(inside) && said2 === null && weakened(inside) && !weakened(outside), 'flying into a nebula is said once, and not again on the next step inside it');
  ok(note.player(outside) === null, 'flying out of it says nothing');
  note.endStep();
  ok(note.player(inside) !== null, 'and flying back in is news again');
  note.endStep();
  note.endStep();
  ok(note.player(inside) !== null, 'as is the next ship flown into one after a step with nobody in the seat');
  note.clear();
  ok(!note.inside && note.player(inside) !== null, 'and a world unload forgets it');
}

// --- 6c. which rows strike, and how many strikes a zone keeps standing ---

{
  const bolt = (every: number, maxSeconds: number) => ({ appearance: '', every, maxSeconds, damage: [10, 20] as [number, number], colour: [1, 1, 1, 1] as NebulaColour, ramp: [1, 1, 1, 1] as NebulaColour, sounds: { strike: null, loop: null }, hit: { client: null, server: null } });
  ok(rowStrikes(row('stormy', [0, 0, 0], 500, { lightning: bolt(0.5, 2) })), 'a row with a lightning appearance, a rate and some density strikes');
  ok(!rowStrikes(row('empty', [0, 0, 0], 500, { density: 0, lightning: bolt(0.5, 2) })), "a row with no density never strikes, whatever its lightning (the game's rule)");
  ok(!rowStrikes(row('becalmed', [0, 0, 0], 500, { lightning: bolt(0, 2) })) && !rowStrikes(row('plain', [0, 0, 0], 500)), 'nor does one with no rate, or no lightning at all');

  ok(strikeRecords([row('plain', [0, 0, 0], 500)], NEBULA_TUNE) === NEBULA_TUNE.liveStrikes, 'a zone with no lightning keeps the fewest records');
  const one = strikeRecords([row('stormy', [0, 0, 0], 500, { lightning: bolt(1, 3) })], NEBULA_TUNE);
  ok(one === Math.ceil(3 + NEBULA_TUNE.liveSpread * Math.sqrt(3) + NEBULA_TUNE.liveSpread), `a row striking once a second for up to three seconds keeps three standing on average, and the pool reaches well past that (${one})`);
  const fast = strikeRecords([row('furious', [0, 0, 0], 500, { lightning: bolt(10, 2) })], NEBULA_TUNE);
  const capped = (NEBULA_TUNE.strikeChanceCap / NEBULA_TUNE.strikeTick) * 2;
  ok(fast === Math.ceil(capped + NEBULA_TUNE.liveSpread * Math.sqrt(capped) + NEBULA_TUNE.liveSpread), "a row asking for more strikes than the game's cap allows is counted at the cap");
  const many = Array.from({ length: 12 }, (_, i) => row(`stormy ${i}`, [i * 100, 0, 0], 500, { lightning: bolt(0.9, 3) }));
  const busy = strikeRecords(many, NEBULA_TUNE);
  ok(busy > 12 * 0.9 * 3, `a zone of twelve busy rows keeps more records than all of them hold standing on average (${busy})`);
  // Rows that share a name share a seed and strike on the same ticks: three of them are one storm
  // whose every strike stands three times over, which strays far further from its mean.
  const apart = strikeRecords([0, 1, 2].map((i) => row(`storm ${i}`, [i * 100, 0, 0], 500, { lightning: bolt(0.5, 2) })), NEBULA_TUNE);
  const together = strikeRecords([0, 1, 2].map((i) => row('one storm', [i * 100, 0, 0], 500, { lightning: bolt(0.5, 2) })), NEBULA_TUNE);
  ok(together > apart, `three rows that share a name keep more records than three named apart (${together} and ${apart})`);
  {
    // And they do strike together: the same ticks, the same lives.
    const found: NebulaStrike[] = [];
    const a = strikesBetween(seedOfName('one storm'), 0.5, 2, 500, 1_000_000, 1_060_000, found, NEBULA_TUNE, 60).map((s) => `${s.tick}:${s.seconds}`).join();
    const b = strikesBetween(seedOfName('one storm'), 0.5, 2, 900, 1_000_000, 1_060_000, found, NEBULA_TUNE, 60).map((s) => `${s.tick}:${s.seconds}`).join();
    ok(a.length > 0 && a === b, 'two rows of one name strike on the same ticks for the same lives, whatever their size');
  }
  ok(strikeRecords([row('stormy', [0, 0, 0], 500, { lightning: bolt(1, 1e9) })], NEBULA_TUNE) === NEBULA_TUNE.liveMost, 'and no zone is given more than the most');
  ok(strikeRecords([row('still', [0, 0, 0], 500, { density: 0, lightning: bolt(1, 3) })], NEBULA_TUNE) === NEBULA_TUNE.liveStrikes, 'a row that cannot strike asks for no records');
}

// --- 7. what a strike takes off a ship ---

{
  const band: [number, number] = [100, 300];
  ok(strikeDamage(band, 0, false, NEBULA_TUNE) === 0, 'with the damage switched off a strike only flashes');
  const least = strikeDamage(band, 0, true, NEBULA_TUNE);
  const most = strikeDamage(band, 1, true, NEBULA_TUNE);
  ok(near(least, band[0] * NEBULA_TUNE.damageShare, 1e-9) && near(most, band[1] * NEBULA_TUNE.damageShare, 1e-9), 'a strike does the row\'s own band at the share the owner chose');
  ok(most < band[1], 'which is less than the table\'s own number, as it was meant to be');
  ok(strikeDamage([300, 100], 1, true, NEBULA_TUNE) === most, 'a band written the other way round does the same damage');

  // The shield and nothing under it: the pure rule.
  const input: StatInput = {
    hullClass: 'fighter',
    family: 'a made up hull',
    tier: 2,
    base: { maxSpeed: 140, boostSpeed: 220, accel: 30, brake: 40, turnRate: 1.1, inertia: 0.55 },
    slots: {
      reactor: { compat: ['rct_0'], hitweight: 10, targetable: true },
      engine: { compat: ['eng_0'], hitweight: 10, targetable: true },
      shield_0: { compat: ['shd_0'], hitweight: 10, targetable: false },
      armor_0: { compat: ['arm_0'], hitweight: 10, targetable: false },
      armor_1: { compat: ['arm_0'], hitweight: 10, targetable: false },
    },
    components: {},
    stock: {},
    weaponOf: () => null,
    defaultWeapon: { name: 'a made up gun', projectile: 4, speed: 600, range: 512 },
  };
  const stats = statsFor(input);
  const c = createCondition(stats);
  const r = newHitResult();
  c.shield[0] = 50;
  const parts = c.parts.map((p) => p.hp).join();
  applyShieldHit(c, stats, 80, 0, r);
  ok(c.shield[0] === 0 && r.shieldDown && r.layer === 'shield' && r.dealt === 50, 'a shield of 50 struck for 80 is emptied and the other 30 is thrown away');
  ok(c.armour[0] === stats.armourMax[0] && c.armour[1] === stats.armourMax[1] && c.chassis === stats.chassisMax && c.parts.map((p) => p.hp).join() === parts && c.shield[1] === stats.shieldMax[1], 'the armour, the chassis, every part and the other face are untouched');
  ok(c.sinceHit === 0, 'and the shield waits its delay before it comes back, as after any blow');
  applyShieldHit(c, stats, 80, 0, r);
  ok(r.layer === 'shield' && !r.shieldDown && r.dealt === 0 && c.armour[0] === stats.armourMax[0], 'an empty shield struck again is still a shield hit, and still nothing reaches the armour');

  // And through a ship's own fight: the face by the bolt's nearest point, the effect, the rest.
  const placed: string[] = [];
  const fx = {
    place: (file: string) => {
      placed.push(file);
      return placed.length;
    },
    remove: () => {},
    flash: () => {},
    hardpoint: () => null,
  };
  const hitEffects = { shield: { hit: ['shield_light.prt', 'shield_medium.prt', 'shield_heavy.prt'], event: [null, null, null] }, armor: { hit: ['armour.prt', 'armour.prt', 'armour.prt'], event: [null, null, null] } } as unknown as CombatFile['hitEffects'];
  const hull = {
    spec: { maxSpeed: 140, boostSpeed: 220, accel: 30, brake: 40, turnRate: 1.1, inertia: 0.55, bounds: { min: [-3, -1, -5], max: [3, 1, 5] } },
    hp: 100,
    maxHp: 100,
    struck: 0,
    group: new THREE.Group(),
    guns: [],
  };
  const ship = new ShipCombat(hull, {} as never, input, fx, null, hitEffects);
  ship.cond.shield[0] = 50;
  const ahead = new THREE.Vector3(0, 0, 6);
  ok(ship.lightningReady && ship.lightning(80, ahead), "a ship that has not been struck takes lightning");
  ok(ship.cond.shield[0] === 0 && ship.cond.shield[1] === ship.stats.shieldMax[1], "a bolt passing ahead of the ship's middle drains the front shield, and only the front");
  ok(ship.cond.armour[0] === ship.stats.armourMax[0] && ship.cond.chassis === ship.stats.chassisMax && hull.hp === 100, 'and the armour and the hull are as they were');
  ok(placed.length === 1 && placed[0].startsWith('shield_'), "the shield's own hit effect plays where the bolt passed");
  ok(!ship.lightning(80, ahead) && !ship.lightningReady, 'a second strike straight after is refused: the ship rests between strikes');
  ship.update(NEBULA_TUNE.hitEvery * 0.9, 0);
  ok(!ship.lightning(80, ahead), `and still refused just under ${NEBULA_TUNE.hitEvery} seconds later`);
  ship.update(NEBULA_TUNE.hitEvery * 0.2, 0);
  const behind = new THREE.Vector3(0, 0, -6);
  const back = ship.cond.shield[1];
  ok(ship.lightning(10, behind) && near(ship.cond.shield[1], back - 10, 1e-9) && ship.cond.shield[0] === 0, 'once the rest has passed it is struck again, and a bolt passing behind the middle takes the back shield');
  ok(placed.length === 2 && placed[1].startsWith('shield_'), 'an empty shield or a full one, it is always the shield effect that plays');
  ship.update(NEBULA_TUNE.hitEvery + 0.1, 0);
  ship.god = true;
  const godShield = ship.cond.shield[1];
  ok(ship.lightning(1000, behind) && ship.cond.shield[1] === godShield, 'in god mode the strike lands and takes nothing');
  // A ship already destroyed is not struck at all: nothing taken, no effect, no rest begun.
  ship.update(NEBULA_TUNE.hitEvery + 0.1, 0);
  ship.god = false;
  const effectsBefore = placed.length;
  ship.cond.chassis = 0;
  ok(!ship.lightningReady && !ship.lightning(80, ahead) && placed.length === effectsBefore, 'a destroyed ship refuses the strike: no shield effect plays on a wreck');
}

// --- 8. the bolt's shape and life ---

{
  const points = [
    [0, 0],
    [0.35, 3],
    [0.95, 3],
    [1, 8],
  ];
  ok(waveAt(points, 0) === 0 && waveAt(points, 1) === 8, 'a waveform reads its own ends');
  ok(near(waveAt(points, 0.175), 1.5, 1e-6), 'and runs straight between its points');
  ok(waveAt([], 0.5) === 0, 'a waveform with no points is nothing at all');
  const curve = beamCurves(points, 9);
  ok(curve.length === 9 && Math.max(...curve) === 1, 'a curve is sampled evenly and scaled so its largest value is one');
  ok(beamCurves([], 5).every((v) => v === 1), 'a bolt with no curve at all is the same width all the way along');

  ok(beamEnvelope(-0.1, 1, NEBULA_TUNE) === 0 && beamEnvelope(1.1, 1, NEBULA_TUNE) === 0, 'a bolt shows nothing before it starts or after it has gone');
  ok(beamEnvelope(0.001, 1, NEBULA_TUNE) < 0.5 && beamEnvelope(0.3, 1, NEBULA_TUNE) === 1, 'it comes up quickly and then holds');
  ok(beamEnvelope(0.95, 1, NEBULA_TUNE) < 1, 'and fades out at the end rather than vanishing at its brightest');
}

// --- 8b. the mist's order, far to near, without making anything ---

{
  const count = 1500;
  const keys = new Float32Array(count);
  const order = new Int32Array(count);
  const scratch = new Int32Array(count);
  let seed = 12345;
  for (let i = 0; i < count; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    keys[i] = seed % 100000;
    order[i] = i;
  }
  sortFarToNear(order, keys, count, scratch);
  let falls = true;
  for (let i = 1; i < count; i++) if (keys[order[i - 1]] < keys[order[i]]) falls = false;
  ok(falls, 'the sheets come out farthest first, all fifteen hundred of them');
  ok(new Set(order).size === count, 'and every sheet is there exactly once, none lost and none drawn twice');

  // Equal distances must keep the order they came in, or the picture flickers where two sheets tie.
  const ties = new Float32Array([5, 5, 9, 5, 9]);
  const tieOrder = new Int32Array([0, 1, 2, 3, 4]);
  sortFarToNear(tieOrder, ties, 5, new Int32Array(5));
  ok(tieOrder[0] === 2 && tieOrder[1] === 4 && tieOrder[2] === 0 && tieOrder[3] === 1 && tieOrder[4] === 3, 'sheets exactly as far off keep the order they were in, so nothing flickers between two frames');

  const one = new Int32Array([0]);
  sortFarToNear(one, new Float32Array([1]), 1, new Int32Array(1));
  ok(one[0] === 0, 'a single sheet is left where it is');

  // The point of it: no comparator, no copy of the array, nothing made while the player is flying.
  // `%TypedArray%.sort` with a comparator costs about 1.7 KB a call, which is two megabytes here.
  // The first two thousand are a warm-up that is not measured: the engine tiers the function up while
  // they run and the code and feedback it writes land on the heap, which is not the sort allocating
  // anything, and it is enough on a loaded machine to fail a check that is really about the sort.
  for (let i = 0; i < 2000; i++) sortFarToNear(order, keys, count, scratch);
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) sortFarToNear(order, keys, count, scratch);
  const grew = process.memoryUsage().heapUsed - before;
  ok(grew < 1024 * 1024, `two thousand orderings of fifteen hundred sheets make next to nothing (${Math.round(grew / 1024)} KB)`);
}

// --- 9. the camera shake ---

{
  const out: ViewShake = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
  shakeAt(3.21, 0, out, NEBULA_TUNE);
  ok(out.yaw === 0 && out.x === 0, 'nothing shakes where there is nothing to shake it');
  let biggestTurn = 0;
  let biggestShift = 0;
  for (let t = 0; t < 10; t += 0.01) {
    shakeAt(t, 1, out, NEBULA_TUNE);
    biggestTurn = Math.max(biggestTurn, Math.abs(out.yaw), Math.abs(out.pitch), Math.abs(out.roll));
    biggestShift = Math.max(biggestShift, Math.abs(out.x), Math.abs(out.y));
  }
  ok(biggestTurn <= NEBULA_TUNE.shakeTurn + 1e-9 && biggestShift <= NEBULA_TUNE.shakeShift + 1e-9, 'the shake never goes past the numbers it is given');
  ok(biggestTurn > NEBULA_TUNE.shakeTurn * 0.9, 'and it does reach them');
  const a = { ...out };
  shakeAt(3.21, 1, out, NEBULA_TUNE);
  const b = { ...out };
  shakeAt(3.21, 1, out, NEBULA_TUNE);
  ok(out.yaw === b.yaw && out.pitch === b.pitch, 'the same moment shakes the same way, so a pause and a step give the same view');
  ok(a.yaw !== out.yaw || a.pitch !== out.pitch, 'and the shake does move as the seconds go by');
}

// --- 10. the owner's own zones, when they are converted (pass or fail only) ---

{
  const packs = new URL('../../../assets-private/', import.meta.url);
  const zones = existsSync(packs) ? readdirSync(packs).filter((d) => d.startsWith('space_') && existsSync(new URL(`${d}/space.json`, packs))) : [];
  if (!zones.length) console.log('note  no converted space packs here, so the zones themselves were not checked');
  let withNebulae = 0;
  let withLightning = 0;
  for (const zone of zones) {
    const pack = JSON.parse(readFileSync(new URL(`${zone}/space.json`, packs), 'utf8')) as { nebulae?: Nebula[] };
    const rows = pack.nebulae ?? [];
    if (!rows.length) continue;
    withNebulae++;
    const counts = shareSheets(
      rows.map((r) => sheetCount(r.radius, r.density, NEBULA_TUNE)),
      NEBULA_TUNE.zoneSheets,
    );
    const total = counts.reduce((a, b) => a + b, 0);
    // The cap, plus at most the three sheets the share keeps for a nebula that would round to none;
    // and in practice within a twentieth of the cap, which is what the budget was measured at.
    ok(
      total <= NEBULA_TUNE.zoneSheets + 3 * rows.length && total <= NEBULA_TUNE.zoneSheets * 1.05 && counts.every((c) => c >= 3),
      `${zone} draws a sheet count inside the zone's budget, with every nebula in it`,
    );
    ok(
      rows.every((r) => {
        const sheets = buildSheets(r, 0, Math.min(8, counts[0]), NEBULA_TUNE);
        return sheets.every((s) => Number.isFinite(s.x) && Number.isFinite(s.size) && s.size > 0);
      }),
      `${zone} places every nebula's sheets at a real place and a real size`,
    );
    if (rows.some((r) => r.lightning && r.lightning.every > 0)) withLightning++;
    // The game layers one cloud out of several rows about one middle; ours is taken once from the
    // densest, so even the middle of the thickest cloud leaves a ship moving and its shields coming back.
    const held = newNebulaSystems();
    const f: SystemFactors = { engine: 1, reactor: 1, shields: 1 };
    ok(
      rows.every((r) => {
        systemFactors(nebulaSystemsAt(rows, r.at[0], r.at[1], r.at[2], held), f);
        return f.engine >= 0.85 && f.reactor * f.shields > 0.1;
      }),
      `${zone}: at the middle of every nebula a ship keeps most of its speed and some of its shields' recharge, however many rows overlap there`,
    );
    // The busiest the zone can be: a ship in every nebula that strikes, so every one of them is asked,
    // for ten minutes of the clock. The zone's own record pool must hold every strike.
    const striking = rows.filter((r) => rowStrikes(r));
    if (striking.length && (pack as { nebulaLook?: unknown }).nebulaLook) {
      const everywhere: NebulaShip[] = striking.map((r) => ({
        label: r.name,
        dead: false,
        vehicle: { ghosted: false, held: false, pos: new THREE.Vector3(r.at[0], r.at[1], r.at[2]), radius: 8 },
        nebula: { inside: 1 },
        combat: { lightningReady: true, nebula: { engine: 1, reactor: 1, shields: 1 }, lightning: () => true },
      }));
      let t = 1_700_000_000_000;
      const zoneSet = await Nebulae.build(
        { place: () => null, remove: () => {}, flash: () => {}, ships: () => everywhere, strike: () => true, playerShip: () => null, damageEnabled: () => true, now: () => t, texture: async () => new THREE.Texture() },
        pack as unknown as SpacePack,
        (f) => f,
        async () => {},
        () => true,
      );
      const far = new THREE.PerspectiveCamera(60, 1.7, 0.05, 9000);
      far.position.set(1e7, 1e7, 1e7);
      for (let i = 0; i < 6000 && zoneSet; i++) {
        t += 100;
        zoneSet.update(0.1, far);
      }
      const tally = zoneSet ? (zoneSet.report() as { lightning: { strikes: number; crowded: number; bumped: number } }).lightning : null;
      ok(!!tally && tally.strikes > 0 && tally.crowded === 0 && tally.bumped === 0, `${zone}: ten minutes with a ship in every nebula that strikes loses no strike for want of a record`);
      zoneSet?.dispose(() => {});
    }
  }
  if (withNebulae) ok(withNebulae > 0 && withLightning > 0, 'the converted zones carry nebulae, and lightning strikes in some of them');
}

// --- 11. the set itself, built and stepped without a browser ---

{
  // Three runs in node as long as nothing is drawn, so the whole set can be built, stepped and
  // freed here: what is drawn, what the haze does, who is struck, and that nothing is left behind.
  const look = {
    shader: '',
    effect: null,
    blend: 'alpha' as const,
    texture: 'nebula/mist.png',
    shell: { shader: '', effect: null, texture: 'nebula/mist.png' },
  };
  const stormy = { appearance: '', every: 2, maxSeconds: 1.5, damage: [40, 120] as [number, number], colour: [0.5, 1, 0.6, 0.2] as NebulaColour, ramp: [0.5, 1, 0.9, 0.3] as NebulaColour, sounds: { strike: null, loop: null }, hit: { client: null, server: null } };
  const rows: Nebula[] = [
    row('near and thick', [0, 0, 0], 2000, { shader: 'mist', jitter: 0.5, lightning: stormy }),
    row('far and glowing', [30000, 0, 0], 3000, { shader: 'glow' }),
    // A second storm far from everything, which nothing ever flies into, and a nebula that names
    // lightning and has no density at all, which the game's rule says never strikes.
    row('far and stormy', [-30000, 0, 0], 2000, { shader: 'mist', lightning: { ...stormy, every: 1 } }),
    row('still and empty', [0, -30000, 0], 1000, { shader: 'mist', density: 0, lightning: { ...stormy, every: 5 } }),
  ];
  const pack = {
    version: 3,
    zone: 'a made up zone',
    planet: null,
    title: 'a made up zone',
    stations: [],
    scenery: [],
    planets: [],
    arrival: null,
    hyperspace: null,
    nebulae: rows,
    nebulaLook: { glow: { ...look, blend: 'add' as const, texture: 'nebula/glow.png' }, mist: look },
    lightning: {
      source: '',
      flipbook: { shader: '', frames: 4, frameStart: 0, frameEnd: 3, uvSize: 0.5, perColumn: 2, fps: 10, visible: true },
      texture: 'nebula/lightning.png',
      // Two curves of different shapes, so which one shapes what can be told apart.
      waveforms: [
        { interp: 0, sample: 0, points: [[0, 0], [0.5, 3], [1, 8]] },
        { interp: 0, sample: 0, points: [[0, 8], [0.5, 1], [1, 4]] },
      ],
      value: 0.2,
      start: null,
      end: null,
      trailingBytes: 0,
    },
    fields: [],
    lanes: {},
    dockEffects: {},
  };

  let clock = 1_700_000_000_000;
  let flashes = 0;
  let opacity = 1;
  let damageOn = true;
  // Ships as the lightning sees them: each counts the strikes it took, keeps the point on the bolt it
  // was handed (where its own fight would choose a shield by), and can be told to rest.
  type StubShip = NebulaShip & { hits: number; ready: boolean; took: number; lastAt: THREE.Vector3 | null; vehicle: { ghosted: boolean; held: boolean; pos: THREE.Vector3; radius: number } };
  const stubShip = (label: string, at: [number, number, number], radius: number): StubShip => {
    const s = {
      label,
      dead: false,
      vehicle: { ghosted: false, held: false, pos: new THREE.Vector3(...at), radius },
      nebula: { inside: 0 },
      hits: 0,
      took: 0,
      ready: true,
      lastAt: null as THREE.Vector3 | null,
      combat: null as NebulaShip['combat'],
    };
    s.combat = {
      get lightningReady() {
        return s.ready;
      },
      nebula: { engine: 1, reactor: 1, shields: 1 },
      lightning: (amount: number, where: THREE.Vector3) => {
        if (!s.ready) return false;
        s.hits++;
        s.took += amount;
        s.lastAt = where.clone();
        return true;
      },
    };
    return s as StubShip;
  };
  const fleet: StubShip[] = [];
  let player: StubShip | null = null;
  const nebulae = await Nebulae.build(
    {
      place: () => null,
      remove: () => {},
      flash: () => {
        flashes++;
      },
      ships: () => fleet,
      strike: (ship, amount, at) => ship.combat?.lightning(amount, at) ?? false,
      playerShip: () => player,
      damageEnabled: () => damageOn,
      opacity: () => opacity,
      now: () => clock,
      texture: async () => new THREE.Texture(),
    },
    pack,
    (f) => f,
    async () => {},
    () => true,
  );
  ok(!!nebulae, 'a zone with nebulae and a look to draw them with builds a set');
  const set = nebulae!;
  ok(set.records === strikeRecords(rows, NEBULA_TUNE) && set.records > NEBULA_TUNE.liveStrikes, `the zone is given as many strike records as its own rows call for (${set.records})`);
  const camera = new THREE.PerspectiveCamera(60, 1.7, 0.05, 9000);
  ok(set.sheets > 0 && set.sheets <= NEBULA_TUNE.zoneSheets, 'the zone draws sheets, and no more than its budget');
  const drawn = set.group.children.filter((o) => (o as THREE.Mesh).isMesh).length;
  ok(drawn === 2 + 2 + NEBULA_TUNE.beams, 'the whole zone is two sheet sets, two hazes and the bolt pool, and nothing else');
  ok(
    set.group.children.every((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.Material;
      return !m.castShadow && !m.receiveShadow && !m.frustumCulled && mat.userData.unlit === true && mat.userData.dry === true && mat.depthWrite === false;
    }),
    'nothing a nebula draws casts a shadow, writes depth, joins the cascades or is ever wet',
  );

  // Outside them all: no haze, nothing dimmed.
  camera.position.set(0, 0, 9000);
  set.update(0.016, camera);
  let report = set.report() as { inside: unknown; haze: { drawn: boolean }[]; dim: { flare: number; rays: number } };
  ok(report.inside === null && report.haze.every((h) => !h.drawn), 'outside every nebula there is no haze at all');
  ok(report.dim.flare === 1 && report.dim.rays === 1, 'and the flare and the god rays are untouched');

  // In the middle of the thick one: haze up, the star dimmed, the view shaking.
  camera.position.set(0, 0, 0);
  set.update(0.016, camera);
  report = set.report() as typeof report;
  ok(!!report.inside, 'inside one, the set knows which one it is in');
  ok(report.haze.some((h) => h.drawn), 'the haze comes up around the camera');
  ok(report.dim.flare < 0.2 && report.dim.rays < 0.3, 'and deep inside, the flare and the rays are mostly gone');
  ok(viewShakeAmount() > 0, 'a nebula the table gives a shake to shakes the view');

  // The Graphics page's Nebula opacity: the sheets and the haze thinned together, the flare and the
  // rays dimmed less to match, the console's own knob left as it is, and nothing made.
  {
    const sheetAlpha = () => set.group.children.filter((o) => o.name === 'nebula:mist' || o.name === 'nebula:glow').map((o) => ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uAlpha.value as number);
    const hazeAlpha = () => (set.report() as { haze: { drawn: boolean; alpha: number }[] }).haze.filter((h) => h.drawn).map((h) => h.alpha);
    const materials = new Set(set.group.children.map((o) => (o as THREE.Mesh).material));
    // The console's own knobs as they stand before the slider moves, whatever their defaults are.
    const knobs = { alpha: NEBULA_TUNE.alpha, shellAlpha: NEBULA_TUNE.shellAlpha };
    const full = { sheets: sheetAlpha(), haze: hazeAlpha(), dim: (set.report() as typeof report).dim };
    ok(full.sheets.length === 2 && full.sheets.every((a) => a === NEBULA_TUNE.alpha), 'at 100% every sheet set is drawn at the console\'s own alpha');
    opacity = 0.5;
    set.update(0.016, camera);
    const half = (set.report() as typeof report).dim;
    ok(sheetAlpha().every((a) => Math.abs(a - NEBULA_TUNE.alpha * 0.5) < 1e-12), 'at 50% the sheets take half of it');
    ok(hazeAlpha().every((a, i) => Math.abs(a - full.haze[i] * 0.5) < 2e-3) && hazeAlpha().length === full.haze.length, 'and the haze inside half of its own, together');
    ok(half.flare > full.dim.flare && half.rays > full.dim.rays && half.flare < 1, `a thinned nebula takes less off the sun: the flare is left at ${half.flare} where it was ${full.dim.flare}`);
    ok(Math.abs(half.flare - dimInside(seenDepth((set.report() as { inside: { depth: number } }).inside.depth, 0.5), NEBULA_TUNE.dimFlare)) < 2e-3, 'by the depth the camera is in, times the opacity');
    opacity = 0;
    set.update(0.016, camera);
    const none = (set.report() as typeof report).dim;
    ok(sheetAlpha().every((a) => a === 0) && hazeAlpha().every((a) => a === 0), 'at 0% nothing of it shows');
    ok(none.flare === 1 && none.rays === 1, 'and the flare and the rays are left alone');
    ok(NEBULA_TUNE.alpha === knobs.alpha && NEBULA_TUNE.shellAlpha === knobs.shellAlpha, 'the console\'s knobs are not written by the slider');
    ok(set.group.children.every((o) => materials.has((o as THREE.Mesh).material)), 'and the slider makes no material: uniforms only, nothing compiles');
    opacity = Number.NaN;
    set.update(0.016, camera);
    ok(sheetAlpha().every((a) => a === NEBULA_TUNE.alpha), 'a setting that is not a number reads as 100%');
    opacity = 1;
    set.update(0.016, camera);
  }
  ok(clampOpacity(2) === 1 && clampOpacity(-1) === 0 && clampOpacity(0.25) === 0.25, 'the opacity is held between 0 and 1');
  ok(seenDepth(0.8, 0.5) === 0.4 && seenDepth(2, 1) === 1 && seenDepth(0.8, 0) === 0, 'the depth the dimming reads is the depth times the opacity');
  // The slider itself: the set above is handed its opacity by the test, so what the game hands it is
  // read out of the source (world.ts and the menu cannot load under node).
  {
    const read = (rel: string) => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), 'utf8');
    ok(/opacity: \(\): number => liveSettings\(\)\.nebulaOpacity,/.test(read('world/world.ts')), "the world hands the nebulae the Graphics page's own setting, read live");
    ok(/\{ key: 'nebulaOpacity', label: 'Nebula opacity', kind: 'range', min: 0, max: 1,/.test(read('ui/menu.ts')), 'and the Graphics page has the slider, 0 to 100%');
    ok(/nebulaOpacity: 0\.1,/.test(read('core/settings.ts')), "which starts at 10%, the owner's choice");
    // The ship contacts cannot load under node either: what they hand each ship and say on the
    // message line is the pure rule tested above, read out of the source.
    const contacts = read('space/contacts.ts');
    ok(/shipSystemsAt\(rows, c\.vehicle, c\.nebula, NEBULA_SYSTEMS\);\s*combat\.setNebula\(c\.nebula\);/.test(contacts), 'every ship that fights is weighed on by the rule above each step, a hull in a jump or held by nothing');
    ok(/if \(c === this\.playerShip\) \{[^}]*this\.nebulaNote\.player\(combat\.nebula\)/.test(contacts) && /this\.nebulaNote\.endStep\(\);/.test(contacts) && /this\.nebulaNote\.clear\(\);/.test(contacts), "and only the player's ship speaks on the message line, once on the way in");
    // The strikes' clock is the one the weather reads, so two browsers on one server see the same strikes.
    ok(/now: \(\): number => sharedClock\.now\(\) - sharedClock\.lagNow\(\),/.test(read('world/world.ts')), "the world times the strikes on the weather's own clock, the server's while one answers");
  }

  // The bolts and the strikes. With nobody flying, the console's strike stands where the nebula's
  // next tick would put it; two bolts are drawn at once and no more, and every strike stands either way.
  {
    // A stub rests once struck, as a ship's own fight does, until it is told it may be struck again.
    const rests = (s: StubShip): StubShip => {
      const take = s.combat!.lightning;
      (s.combat as { lightning: (amount: number, at: THREE.Vector3) => boolean }).lightning = (amount, at) => {
        const struck = take(amount, at);
        if (struck) s.ready = false;
        return struck;
      };
      return s;
    };
    const lightningOf = () => (set.report() as { lightning: { beams: number; strikes: number; hits: number }; hitsByShip: { player: number; npc: number }; live: number });
    const first = set.forceStrike(camera.position);
    const second = set.forceStrike(camera.position);
    const third = set.forceStrike(camera.position);
    ok(first.includes(', drawn,') && second.includes(', drawn,'), 'two bolts can be drawn at once');
    ok(third.includes('every bolt is busy'), 'and a third strike is not drawn, rather than making a bolt out of nothing');
    ok(flashes === 2, 'each drawn bolt borrows one pooled light and no more');
    ok(set.liveCount === 3, 'but all three strikes stand, drawn or not');

    // A ship a bolt passes is struck, whether or not that bolt is drawn: here both bolts are busy.
    const npc = rests(stubShip('a made up fighter', [1500, 0, 0], 8));
    fleet.push(npc);
    const busy = set.strikeThrough(0, new THREE.Vector3(1500, -50, 0), new THREE.Vector3(1500, 50, 0), 1, 0.5, clock, camera.position);
    ok(busy === 'busy', 'a strike while both bolts are busy is not drawn');
    set.update(0.016, camera);
    ok(npc.hits === 1, 'and still strikes the NPC ship it passes through: a strike is not the bolt drawn for it');
    ok(near(npc.took, strikeDamage([40, 120], 0.5, true, NEBULA_TUNE), 1e-9), "for the row's band at the strike's own roll, at the owner's share");
    set.update(0.016, camera);
    ok(npc.hits === 1, 'a ship resting from a strike is not struck again by the bolt it is still under');

    // Everything a bolt passes, and nothing it does not.
    const inLine = [rests(stubShip('first in line', [0, 1500, 300], 8)), rests(stubShip('second in line', [0, 1500, -300], 8))];
    const beside = rests(stubShip('just beside it', [0, 1520, 0], 8));
    const ghost = rests(stubShip('in a jump', [0, 1500, 100], 8));
    ghost.vehicle.ghosted = true;
    const held = rests(stubShip('held where it is', [0, 1500, -100], 8));
    held.vehicle.held = true;
    const dead = rests(stubShip('already gone', [0, 1500, 0], 8));
    (dead as { dead: boolean }).dead = true;
    // Four metres off the bolt, two hundred along it: struck, at the foot of the line from its middle
    // to the bolt, which is where its own fight picks the front or the back shield by.
    const offLine = rests(stubShip('off the line', [0, 1504, 200], 8));
    fleet.push(...inLine, beside, ghost, held, dead, offLine);
    set.strikeThrough(0, new THREE.Vector3(0, 1500, 500), new THREE.Vector3(0, 1500, -500), 1, 0.2, clock, camera.position);
    set.update(0.016, camera);
    ok(inLine.every((s) => s.hits === 1), 'two ships under one bolt are both struck');
    ok(beside.hits === 0, 'a ship twenty metres off the bolt, whose reach is eight, is not');
    ok(ghost.hits === 0 && held.hits === 0 && dead.hits === 0, 'nor is a ship in a jump, one held where it is, or one already gone');
    ok(offLine.hits === 1 && !!offLine.lastAt && offLine.lastAt.distanceTo(new THREE.Vector3(0, 1500, 200)) < 1e-9, `a ship beside the bolt is handed the bolt's nearest point to its middle, not either end (${offLine.lastAt?.toArray().join(', ')})`);

    // A strike too far off to be drawn still strikes.
    const lonely = rests(stubShip('far from the camera', [-1500, 0, 0], 8));
    fleet.push(lonely);
    const far = set.strikeThrough(0, new THREE.Vector3(-1500, 0, -40), new THREE.Vector3(-1500, 0, 40), 1, 0.3, clock, new THREE.Vector3(0, 0, 50000));
    set.update(0.016, camera);
    ok(far === 'far' && lonely.hits === 1, 'a strike too far from the camera to be drawn still strikes the ship it passes');

    // With the setting off nothing is struck.
    damageOn = false;
    const spared = rests(stubShip('with the damage off', [0, -1500, 0], 8));
    fleet.push(spared);
    set.strikeThrough(0, new THREE.Vector3(0, -1500, -40), new THREE.Vector3(0, -1500, 40), 0.2, 0.3, clock, camera.position);
    set.update(0.016, camera);
    ok(spared.hits === 0, 'with lightning damage switched off a strike touches nothing');
    clock += 2000;
    set.update(2, camera);
    damageOn = true;
    set.update(0.016, camera);
    ok(spared.hits === 0, 'and a strike that stood while it was off is over before it comes back on, so it never lands late');
    const report = lightningOf();
    ok(report.hitsByShip.npc === 5 && report.hitsByShip.player === 0 && report.lightning.hits === 5, 'the console counts the hits by whose ship they were');
    ok(report.lightning.beams <= NEBULA_TUNE.beams, 'never more bolts than the pool holds');

    // On the clock, with a ship inside: a nebula far from the camera is asked all the same when a
    // ship is inside it, and not while it holds nobody.
    fleet.length = 0;
    const farCamera = new THREE.PerspectiveCamera(60, 1.7, 0.05, 9000);
    farCamera.position.set(0, 0, 60000);
    let before = lightningOf().lightning.strikes;
    for (let i = 0; i < 200; i++) {
      clock += 100;
      set.update(0.1, farCamera);
    }
    ok(lightningOf().lightning.strikes === before, 'a nebula far from the camera with nobody in it is never asked for its strikes');
    fleet.push(stubShip('alone in the nebula', [1800, 0, 0], 8));
    before = lightningOf().lightning.strikes;
    for (let i = 0; i < 200; i++) {
      clock += 100;
      set.update(0.1, farCamera);
    }
    const asked = lightningOf().lightning.strikes - before;
    // Two hundred ticks at a fifth of a chance each is forty, give or take six: held within two and a
    // half spreads of that, so a polled rate half or twice what the row asks for shows here too.
    ok(asked >= 25 && asked <= 55, `but once a ship is inside it, it is asked however far off the camera is, as often as its rate says (${asked} strikes in twenty seconds, forty expected)`);

    // The game's rule never moves a bolt: with a ship in the nebula, outside the cube the bolts
    // stand in, no bolt ever ends on it and nothing touches it.
    fleet.length = 0;
    player = rests(stubShip('your ship', [900, 0, 0], 8));
    fleet.push(player);
    const cube = 2000 * NEBULA_TUNE.strikeCube + 1e-6;
    const beams = set.group.children.filter((o) => o.name.startsWith('nebula:lightning:')) as THREE.Mesh[];
    const endsOf = (m: THREE.Mesh): THREE.Vector3[] => [(m.material as THREE.ShaderMaterial).uniforms.uFrom.value as THREE.Vector3, (m.material as THREE.ShaderMaterial).uniforms.uTo.value as THREE.Vector3];
    let inCube = true;
    let onShip = 0;
    let seen = 0;
    for (let i = 0; i < 600; i++) {
      clock += 100;
      player.ready = true;
      set.update(0.1, camera);
      for (const m of beams) {
        if (!m.visible) continue;
        seen++;
        for (const e of endsOf(m)) {
          if (Math.abs(e.x) > cube || Math.abs(e.y) > cube || Math.abs(e.z) > cube) inCube = false;
          if (e.distanceTo(player.vehicle.pos) < 1e-6) onShip++;
        }
      }
    }
    ok(seen > 0 && inCube && onShip === 0, `with bendWithin at 0 every bolt drawn stands in the game's cube and none is moved onto the ship (${seen} bolt-frames seen)`);
    ok(player.hits === 0, 'and a ship outside that cube is never struck at all, which is the game\'s rule');
    // The knob that brings back this game's old aim. The stub is let out of its rest every two
    // seconds, as a ship's own fight lets it out.
    NEBULA_TUNE.bendWithin = 900;
    for (let i = 0; i < 600; i++) {
      clock += 100;
      if (i % Math.round(NEBULA_TUNE.hitEvery * 10) === 0) player.ready = true;
      set.update(0.1, camera);
      for (const m of beams) if (m.visible && endsOf(m)[1].distanceTo(player.vehicle.pos) < 1e-6) onShip++;
    }
    NEBULA_TUNE.bendWithin = 0;
    ok(onShip > 0 && player.hits > 0, `with bendWithin at 900 a strike ending near the player's ship is moved onto it and strikes it, as this game aimed before (${player.hits} strikes in a minute)`);
    ok(lightningOf().hitsByShip.player === player.hits, 'and those hits are counted as the player\'s');

    // The console's strike goes straight through the player's ship.
    player.ready = true;
    const hitsBefore = player.hits;
    const through = set.forceStrike(camera.position);
    ok(through.includes('through your ship') && through.includes('and it struck') && player.hits === hitsBefore + 1, `the console's strike stands through the player's ship and strikes it (${through})`);
    player.ready = false;
    const resting = set.forceStrike(camera.position);
    ok(resting.includes('resting') && player.hits === hitsBefore + 1, 'and says so when the ship is still resting from the last');
    player = null;
    fleet.length = 0;
    clock += 5000;
    set.update(5, camera);

    // A strike that began before this frame is drawn as far into its life as it already is, so two
    // browsers whose frames fall differently show it at the same point of it.
    {
      const beamsOf = (set as unknown as { beams: { age: number; seconds: number; mesh: THREE.Mesh }[] }).beams;
      const what = set.strikeThrough(0, new THREE.Vector3(0, -20, 0), new THREE.Vector3(0, 20, 0), 2, 0.5, clock - 1000, camera.position);
      const shown = beamsOf.find((b) => b.mesh.visible && b.age < b.seconds);
      ok(what === 'drawn' && !!shown && near(shown.age, 1, 1e-9) && shown.seconds === 2, `a strike begun a second ago is drawn a second into its two (${shown?.age})`);
      clock += 3000;
      set.update(3, camera);
    }

    // A nebula that names lightning and has no density never strikes, a ship inside it or not.
    {
      fleet.push(stubShip('in the empty one', [0, -30000, 0], 8));
      const farCamera = new THREE.PerspectiveCamera(60, 1.7, 0.05, 9000);
      farCamera.position.set(0, 0, 60000);
      const before = lightningOf().lightning.strikes;
      for (let i = 0; i < 200; i++) {
        clock += 100;
        set.update(0.1, farCamera);
      }
      ok(lightningOf().lightning.strikes === before, "a nebula with lightning and no density at all never strikes, with a ship inside it (the game's rule)");
      fleet.length = 0;
    }

    // Every record standing, a zone busier than its rows promised: a strike in a nebula holding a
    // ship takes the record of one standing where nobody is, and any other strike is lost and counted.
    {
      clock += 5000;
      set.update(5, camera);
      const tallyOf = () => (set.report() as { lightning: { crowded: number; bumped: number } }).lightning;
      const nowhere = new THREE.Vector3(0, 0, 1e7);
      const storm = new THREE.Vector3(-30000, 0, 0);
      const stormEnd = new THREE.Vector3(-30000, 10, 0);
      for (let i = 0; i < 1000 && set.liveCount < set.records; i++) set.strikeThrough(2, storm, stormEnd, 10, 0.5, clock, nowhere);
      ok(set.liveCount === set.records, `every record can be standing at once (${set.records})`);
      const crowded = tallyOf().crowded;
      const bumped = tallyOf().bumped;
      ok(set.strikeThrough(2, storm, stormEnd, 10, 0.5, clock, nowhere) === 'crowded' && tallyOf().crowded === crowded + 1, 'a strike where nobody is, with every record standing, is lost and counted');
      const under = rests(stubShip('under a crowded sky', [0, 300, 0], 8));
      fleet.push(under);
      const taken = set.strikeThrough(0, new THREE.Vector3(-50, 300, 0), new THREE.Vector3(50, 300, 0), 1, 0.5, clock, nowhere);
      ok(taken === 'far' && tallyOf().bumped === bumped + 1 && tallyOf().crowded === crowded + 1 && set.liveCount === set.records, 'but one in a nebula holding a ship takes the record of a strike standing where nobody is');
      set.update(0.016, camera);
      ok(under.hits === 1, 'and strikes the ship it passes');
      fleet.length = 0;
      clock += 20000;
      set.update(20, camera);
    }
  }

  // The bolt's two curves. By default the first widens it and the second says how far it wanders,
  // and nothing shapes how bright it is along its length; `waveAlpha` is the other reading.
  const bolt = set.group.children.find((o) => o.name === 'nebula:lightning:0') as THREE.Mesh;
  const readAttr = (mesh: THREE.Mesh, name: string): number[] => Array.from((mesh.geometry.getAttribute(name) as THREE.BufferAttribute).array as Float32Array);
  const varies = (v: number[]): boolean => Math.max(...v) - Math.min(...v) > 1e-6;
  ok(varies(readAttr(bolt, 'aWidth')), 'the first curve shapes the bolt\'s width along its length');
  ok(varies(readAttr(bolt, 'aWander')), 'the second says how far it wanders off the straight line');
  ok(readAttr(bolt, 'aBright').every((v) => v === 1), 'and nothing dims it along its length, which is the reading of the two curves this game takes');

  // The sort's cadence at a jump's speed: the camera moving 900 m a second at 144 frames a second
  // asks for an ordering on nearly every frame, and the floor must hold it to about ten a second.
  const mist = set.group.children.find((o) => o.name === 'nebula:mist') as THREE.Mesh;
  const version = (): number => (mist.geometry.getAttribute('iCentre') as THREE.BufferAttribute).version;
  const startedAt = version();
  camera.position.set(0, 0, -5000);
  for (let f = 0; f < 144; f++) {
    camera.position.z += 900 / 144;
    set.update(1 / 144, camera);
  }
  const sorts = version() - startedAt;
  ok(sorts > 0 && sorts <= Math.ceil(1 / NEBULA_TUNE.sortLeast) + 1, `a second of flying at a jump's speed orders the mist ${sorts} times, not once a frame`);

  // The density knob: the sheets change and no material is made.
  const materialsBefore = new Set(set.group.children.map((o) => (o as THREE.Mesh).material));
  const sheetsBefore = set.sheets;
  NEBULA_TUNE.density = 0.25;
  set.fill();
  ok(set.sheets < sheetsBefore, 'turning the density down draws fewer sheets');
  const materialsAfter = new Set(set.group.children.map((o) => (o as THREE.Mesh).material));
  ok(materialsBefore.size === materialsAfter.size && [...materialsAfter].every((m) => materialsBefore.has(m)), 'and it makes no new material, so nothing can compile on a live frame');
  NEBULA_TUNE.density = 1;
  set.fill();

  let forgotten = 0;
  set.dispose((mats) => {
    forgotten += mats.length;
  });
  ok(forgotten >= 4, 'everything it drew leaves the portal renderer\'s set and the cascades\' map when the zone goes');
  ok(set.group.children.length === 0, 'and the group is left empty');

  // --- the other reading of the second curve, which the owner can ask for ---

  const plainDeps = {
    place: () => null,
    remove: () => {},
    flash: () => {},
    ships: () => [],
    strike: () => false,
    playerShip: () => null,
    damageEnabled: () => false,
    now: () => clock,
    texture: async () => new THREE.Texture(),
  };
  NEBULA_TUNE.waveAlpha = true;
  const other = await Nebulae.build(plainDeps, pack, (f) => f, async () => {}, () => true);
  NEBULA_TUNE.waveAlpha = false;
  ok(!!other, 'the other reading builds a set too');
  const otherBolt = other!.group.children.find((o) => o.name === 'nebula:lightning:0') as THREE.Mesh;
  ok(varies(readAttr(otherBolt, 'aBright')), 'with it asked for, the second curve is how bright the bolt is along its length');
  ok(readAttr(otherBolt, 'aWander').every((v) => v === 1), 'and the bolt then wanders the same amount all the way along, rather than being shaped twice by one curve');
  ok(varies(readAttr(otherBolt, 'aWidth')), 'while the first curve still widens it either way');
  other!.dispose(() => {});

  // --- a build a travel or a jump abandons part way through ---

  let made = 0;
  let freed = 0;
  let asked = 0;
  const abandoned = await Nebulae.build(
    {
      ...plainDeps,
      texture: async () => {
        made++;
        const t = new THREE.Texture();
        t.addEventListener('dispose', () => {
          freed++;
        });
        return t;
      },
    },
    pack,
    (f) => f,
    async () => {},
    // True while the pictures load, false by the time the meshes are made: the moment a travel
    // lands part way through a build.
    () => asked++ < 1,
  );
  ok(abandoned === null, 'a build the world no longer wants comes back with nothing rather than a set nobody holds');
  ok(made > 0 && freed === made, 'and every picture it had already loaded is freed where it stands');
}

console.log(`\n${passed} checks passed`);
