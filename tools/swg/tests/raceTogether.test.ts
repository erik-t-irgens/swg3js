// Racing together (the racer's wave 4a), as rules and as the browser's half: the race word the relay carries and how it
// is cleaned (server/raceWire.mjs), each member's grid slot behind a track's grid, the countdown read off the shared
// clock so every member's go is one instant and a run's own clock from go, the standings, the gates' digest, why a
// member cannot join, the browser's own module (src/net/raceNet.ts) driven through its hooks as two members of one
// group, and the nudge a racing hull's turn takes away from another player's ride drawn near.
//
// Run: node tools/swg/tests/raceTogether.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RACE_VERSION, RACE_WIRE, cleanRace, mayRace } from '../../../server/raceWire.mjs';
import { RACE_GROUP_TUNE, groupCountdown, gridSlot, joinCheck, newStanding, standingLines, standingsOf, syncGroupCountdown, trackDigest, tuneRaceGroup } from '../../../src/race/raceGroup.ts';
import { RUN_STEP, RaceRun } from '../../../src/race/raceRun.ts';
import { readTrackFile, trackInGame, type TrackDef } from '../../../src/race/trackFile.ts';
import { turnHeading } from '../../../src/race/gates.ts';
import { RaceTogether, outWordFor, type RaceMember } from '../../../src/net/raceNet.ts';
import { RaceDrive } from '../../../src/vehicles/raceDrive.ts';
import { RACE_BASE, RACE_BIKE_SIZES, RACE_TUNE } from '../../../src/vehicles/raceTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const r3 = (n: number) => Number(n.toFixed(3));
/** Two plain values alike, whatever order their keys came in. */
const same = (a: unknown, b: unknown): boolean => {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
};
const T0 = Date.UTC(2026, 9, 18, 12);

const file = readTrackFile(readFileSync(new URL('../../../public/tracks/tatooine.json', import.meta.url), 'utf8'), 'tatooine', 'ground');
const loop = file.tracks.find((t) => t.id === 'test_dune_loop')!;

// --- 1: the word, cleaned ---------------------------------------------------------------------------------------------
{
  const call = { phase: 'call', world: 'tatooine', track: 'test_dune_loop', at: T0, digest: 'a1b2c3d4', laps: 3, members: [4, 9] };
  ok(same(cleanRace(call), call), `1: a call keeps its world, track, start, digest, laps and members in grid order (${JSON.stringify(cleanRace(call))})`);
  ok(cleanRace({ ...call, members: [4, 4] }) === undefined && cleanRace({ ...call, members: [] }) === undefined && cleanRace({ ...call, members: [1, 2, 3, 4, 5, 6, 7, 8, 9] }) === undefined, '1: a call naming a member twice, nobody, or more than a group holds is not one');
  ok(cleanRace({ ...call, digest: 'xyz' }) === undefined && cleanRace({ ...call, laps: 0 }) === undefined && cleanRace({ ...call, laps: RACE_WIRE.lapsMost + 1 }) === undefined, '1: nor one whose digest is not eight hex characters, or whose laps are none or too many');
  ok(cleanRace({ ...call, at: 12345 }) === undefined && cleanRace({ ...call, track: 'Not An Id' }) === undefined && cleanRace({ ...call, track: 'constructor' }) === undefined, '1: a start no shared clock could be, or a track id that is not one, is dropped');
  ok(cleanRace({ ...call, world: '' }) === undefined && cleanRace({ ...call, phase: 'win' }) === undefined && cleanRace(null) === undefined, '1: a word with no world, no phase anybody knows, or nothing at all is dropped');
  const lap = cleanRace({ phase: 'lap', world: 'tatooine', track: 'test_dune_loop', at: T0, n: 2, time: 61.25, total: 122.5, junk: 1 });
  ok(same(lap, { phase: 'lap', track: 'test_dune_loop', world: 'tatooine', at: T0, n: 2, time: 61.25, total: 122.5 }), '1: a lap keeps its number, its time and the time from go, and nothing else');
  ok(cleanRace({ phase: 'lap', world: 'tatooine', track: 'test_dune_loop', at: T0, n: 2, time: -1, total: 1 }) === undefined && cleanRace({ phase: 'finish', world: 'tatooine', track: 'test_dune_loop', at: T0, total: RACE_WIRE.timeMost + 1 }) === undefined, '1: a lap that took no time, or a race that took more than a day, is not one');
  ok(cleanRace({ phase: 'out', world: 'tatooine', track: 'test_dune_loop', at: T0, why: 'bribed' })?.why === 'other', '1: an out word nobody knows is "other"');
  const w = { at: 0, lines: 0 };
  let passed = 0;
  for (let i = 0; i < 20; i++) if (mayRace(w, 5000)) passed++;
  ok(passed === RACE_WIRE.perSecond && mayRace(w, 6001), `1: a browser may send ${RACE_WIRE.perSecond} race words a second, and the next second starts again`);
  ok(RACE_VERSION === 1, '1: the relay says it carries races in its hail (race 1)');
}

// --- 2: the grid ------------------------------------------------------------------------------------------------------
{
  const grid = { x: 100, y: 2, z: -50, heading: 0 };
  const s0 = gridSlot(grid, 0, 'podracer');
  const s1 = gridSlot(grid, 1, 'podracer');
  const s2 = gridSlot(grid, 2, 'podracer');
  ok(Math.abs(s0.z - grid.z) < 1e-9 && Math.abs(s1.z - grid.z) < 1e-9 && Math.abs(s0.x - s1.x - RACE_GROUP_TUNE.across) < 1e-9 && Math.abs((s0.x + s1.x) / 2 - grid.x) < 1e-9, `2: the first row stands on the grid's own line, two slots ${RACE_GROUP_TUNE.across} m apart about its middle`);
  ok(Math.abs(grid.z - s2.z - RACE_GROUP_TUNE.back) < 1e-9 && s2.heading === grid.heading, `2: the next row ${RACE_GROUP_TUNE.back} m behind it, facing the way the grid faces`);
  // At heading nought the nose is +z and the right -x (the drive's own sense): the first slot on the left, the next on the right.
  ok(s0.x > grid.x && s1.x < grid.x, '2: the first slot stands on the grid\'s left, the second on its right');
  const b1 = gridSlot(grid, 1, 'speederbike');
  ok(Math.abs(Math.abs(b1.x - grid.x) - (RACE_GROUP_TUNE.across * RACE_GROUP_TUNE.bikeShare) / 2) < 1e-9, `2: racing bikes stand at ${RACE_GROUP_TUNE.bikeShare} of a pod's spacing`);
  // Turned a quarter, the rows run back along the grid's own heading.
  const turned = { ...grid, heading: Math.PI / 2 };
  const t2 = gridSlot(turned, 2, 'podracer');
  ok(Math.abs(turned.x - t2.x - RACE_GROUP_TUNE.back) < 1e-9 && Math.abs(Math.abs(t2.z - turned.z) - RACE_GROUP_TUNE.across / 2) < 1e-9, '2: a grid turned a quarter puts its rows back along its own heading');
  // On the TEST course: eight slots, none inside another. Every slot faces the grid's way, so two race boxes (the shared
  // pod box, the shared bike box) overlap exactly when they are nearer than a box's width across the grid and its length
  // along it, measured in the grid's own frame.
  const places = trackInGame(loop, null, 'raw');
  const g = { x: places.grid.x, y: places.grid.y, z: places.grid.z, heading: turnHeading(places.grid.q) };
  const overlaps = (kind: 'podracer' | 'speederbike'): number => {
    const box = kind === 'podracer' ? RACE_BASE.podracer.box : RACE_BIKE_SIZES.box;
    const all = Array.from({ length: 8 }, (_, i) => gridSlot(g, i, kind));
    const nx = Math.sin(g.heading);
    const nz = Math.cos(g.heading);
    let n = 0;
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        const dx = all[i].x - all[j].x;
        const dz = all[i].z - all[j].z;
        const along = Math.abs(dx * nx + dz * nz);
        const across = Math.abs(-dx * nz + dz * nx);
        if (across < box[0] - 1e-9 && along < box[2] - 1e-9) n++;
      }
    return n;
  };
  ok(overlaps('podracer') === 0 && overlaps('speederbike') === 0, `2: a full group of eight on the TEST course's grid, pods (${RACE_BASE.podracer.box[0]} by ${RACE_BASE.podracer.box[2]} m) or bikes (${RACE_BIKE_SIZES.box[0]} by ${RACE_BIKE_SIZES.box[2]} m): no slot's race box inside another's`);
  // The test sees a grid that puts boxes inside one another: rows 10 m apart, under a pod's 15 m length.
  tuneRaceGroup({ back: 10 });
  const close = overlaps('podracer');
  tuneRaceGroup({ back: 20 });
  ok(close > 0, `2: with the rows 10 m apart the pods' boxes overlap (${close} pairs), which the check refuses`);
  const words = tuneRaceGroup({ across: 12, perRow: 'three' as unknown as number });
  ok(RACE_GROUP_TUNE.across === 12 && words.length === 1, '2: the spacing moves live, and a number that is not one is refused in words');
  tuneRaceGroup({ across: 9 });
}

// --- 3: the countdown off the shared clock ---------------------------------------------------------------------------
{
  ok(groupCountdown(T0, T0 - 5000) === -Math.ceil(5 / RUN_STEP - 1e-6) * RUN_STEP && groupCountdown(T0, T0 - 5000) <= -5 + 1e-9, '3: five seconds before the start the clock reads minus five, on the physics\' whole steps');
  const odd = groupCountdown(T0, T0 - 1234.5);
  ok(odd < -1.2345 && odd > -1.2345 - RUN_STEP && Math.abs(odd / RUN_STEP - Math.round(odd / RUN_STEP)) < 1e-6, `3: a start between two steps is rounded up to the next (${r3(odd)} s for 1.2345)`);
  ok(Math.abs(groupCountdown(T0, T0 + 750) - 0.75) < 1e-9, '3: after the start the clock is the seconds since it: a member stood at the grid late starts that late');
  // Two members on two frame rates, each stepping its own run's clock by the physics' steps and reading the shared clock
  // every frame until go: go comes on the same instant for both, within a frame, and the countdown never runs ahead.
  const gos: number[] = [];
  for (const fps of [144, 60, 30]) {
    const run = new RaceRun(loop, 'tatooine', 'podracer', 'pod', { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }, trackInGame(loop, null, 'raw').gates, 1, null);
    run.sharedStart = T0;
    let wall = T0 - 8000 + fps;
    let acc = 0;
    let go = Number.NaN;
    for (let i = 0; i < 20 * fps && !Number.isFinite(go); i++) {
      const dt = 1 / fps;
      syncGroupCountdown(run, wall);
      let steps = 0;
      let a = acc + dt;
      while (a >= RUN_STEP && steps < 4) {
        a -= RUN_STEP;
        steps++;
      }
      acc = a;
      run.advanceSteps(steps);
      wall += dt * 1000;
      if (run.phase === 'racing') go = wall;
    }
    gos.push(go);
  }
  const spread = Math.max(...gos) - Math.min(...gos);
  ok(gos.every((g) => Number.isFinite(g)) && spread <= 1000 / 30 + 1e-6 && gos.every((g) => Math.abs(g - T0) <= 1000 / 30 + 1000 / 60 + 1e-6), `3: three members at 144, 60 and 30 fps all reach go at the start, within a frame and a physics step of it and a frame of each other (${gos.map((g) => r3((g - T0) / 1000)).join(', ')} s after it)`);
  // Not synced past go: from go the clock is the run's own steps.
  const run = new RaceRun(loop, 'tatooine', 'podracer', 'pod', { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }, trackInGame(loop, null, 'raw').gates, 1, null);
  run.sharedStart = T0;
  syncGroupCountdown(run, T0 + 10);
  run.advanceSteps(1);
  const after = run.clock;
  syncGroupCountdown(run, T0 + 99999);
  ok(run.phase === 'racing' && run.clock === after, '3: once racing, the shared clock no longer moves the run\'s own');
  const solo = new RaceRun(loop, 'tatooine', 'podracer', 'pod', { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] }, trackInGame(loop, null, 'raw').gates, 1, null);
  const was = solo.clock;
  syncGroupCountdown(solo, T0);
  ok(solo.clock === was && !Number.isFinite(solo.sharedStart), '3: a run of its own (no shared start) is left alone');
}

// --- 4: the standings -------------------------------------------------------------------------------------------------
{
  const a = { ...newStanding(1, 'Ana'), joined: true, laps: 2, total: 120 };
  const b = { ...newStanding(2, 'Bo'), joined: true, laps: 3, total: 185, finished: true };
  const c = { ...newStanding(3, 'Cy', true), joined: true, laps: 2, total: 118 };
  const d = { ...newStanding(4, 'Di'), joined: true, laps: 1, total: 60, out: 'got off' };
  const e = { ...newStanding(5, 'Ed'), joined: false };
  const f = { ...newStanding(6, 'Fa'), joined: true, laps: 3, total: 181, finished: true };
  const order = standingsOf([a, b, c, d, e, f]).map((r) => r.name);
  ok(order.join() === 'Fa,Bo,Cy,Ana,Di', `4: the finished by their time, then the rest by laps and the time at their last, then the ones out; nobody who never joined (${order.join(', ')})`);
  const lines = standingLines([a, b, c, d, e, f], 3);
  ok(lines[0] === '1 Fa 3:01.0' && lines[2] === '3 Cy (you) 2/3 1:58.0' && lines[4] === '– Di out', `4: as the race block says it: ${lines.join(' | ')}`);
}

// --- 5: who may join --------------------------------------------------------------------------------------------------
{
  const race = { world: 'tatooine', track: loop.id, at: T0, digest: trackDigest(loop), members: [7, 3] };
  const here = { world: 'tatooine', track: loop, ride: '', now: T0 - 9000, me: 3 };
  ok(joinCheck(race, here).why === '' && joinCheck(race, here).slot === 1, '5: a member on the world, with the same course and on something that races it, joins in the slot the call gave');
  ok(/on tatooine/.test(joinCheck(race, { ...here, world: 'naboo' }).why), `5: on another world: "${joinCheck(race, { ...here, world: 'naboo' }).why}"`);
  const other: TrackDef = { ...loop, gates: loop.gates.map((g, i) => (i === 3 ? { ...g, x: g.x + 1 } : g)) };
  ok(trackDigest(other) !== trackDigest(loop) && /differs/.test(joinCheck(race, { ...here, track: other }).why), '5: a copy of the file with one gate a metre off has another digest, and sits the race out in words');
  ok(/started/.test(joinCheck(race, { ...here, now: T0 + 1 }).why), '5: after go, too late');
  ok(/not in the group/.test(joinCheck(race, { ...here, me: 12 }).why), '5: not listed when it was called');
  ok(joinCheck(race, { ...here, ride: 'ride a pod first' }).why === 'ride a pod first', '5: and what the player rides says for itself why it cannot race it');
  ok(trackDigest(loop) === trackDigest(readTrackFile(readFileSync(new URL('../../../public/tracks/tatooine.json', import.meta.url), 'utf8'), 'tatooine', 'ground').tracks[0]) && /^[0-9a-f]{8}$/.test(trackDigest(loop)), `5: the same file read twice is the same digest (${trackDigest(loop)})`);
  ok(outWordFor('the rider died') === 'died' && outWordFor('you got off') === 'left' && outWordFor('a jump to another system') === 'world' && outWordFor('stopped from the console') === 'stopped' && outWordFor('the bike left racing mode') === 'vehicle', '5: the game\'s words for a run ended are the out word\'s');
}

// --- 6: two members of one group, through the browser's own module ----------------------------------------------------
{
  let clock = T0;
  const wire: { from: number; msg: Record<string, unknown> }[] = [];
  const roster: RaceMember[] = [
    { id: 7, name: 'Ana', leader: true },
    { id: 3, name: 'Bo', leader: false },
  ];
  type Member = { rt: RaceTogether; notes: string[]; runs: { at: number; slot: number }[]; run: { at: number; live: boolean } | null };
  const member = (id: number, name: string, leads: boolean): Member => {
    const rt = new RaceTogether();
    const m: Member = { rt, notes: [], runs: [], run: null };
    rt.send = (msg) => wire.push({ from: id, msg });
    rt.authority = () => 'server';
    rt.raceVersion = () => 1;
    rt.note = (t) => m.notes.push(t);
    rt.now = () => clock;
    rt.leading = () => leads;
    rt.myId = () => id;
    rt.myName = () => name;
    rt.members = () => roster;
    rt.world = () => 'tatooine';
    rt.track = (t) => (t === loop.id ? loop : null);
    rt.canRace = () => '';
    rt.join = async (race, slot) => {
      m.runs.push({ at: race.at, slot });
      m.run = { at: race.at, live: true };
      return '';
    };
    rt.ownsRun = (race) => !!m.run && m.run.at === race.at;
    rt.stop = () => {
      if (m.run) m.run.live = false;
      m.rt.ranOut('you left the race');
    };
    return m;
  };
  const ana = member(7, 'Ana', true);
  const bo = member(3, 'Bo', false);
  // The relay: each word to the rest of the group, with who sent it.
  const deliver = () => {
    while (wire.length) {
      const { from, msg } = wire.shift()!;
      const clean = cleanRace(msg);
      if (!clean) continue;
      for (const [id, m] of [[7, ana], [3, bo]] as const) if (id !== from) m.rt.handle({ t: 'race', id: from, from: from === 7 ? 'Ana' : 'Bo', ...clean });
    }
  };
  ok(/only the leader/.test(bo.rt.call(loop.id)), '6: only the leader calls a race');
  const said = ana.rt.call(loop.id, 15);
  await Promise.resolve();
  await Promise.resolve();
  deliver();
  ok(/called/.test(said) && ana.runs.length === 1 && ana.runs[0].slot === 0 && ana.rt.race?.mine === 'joined', `6: the leader calls it ("${said}") and is stood in slot 1 of their own call`);
  ok(bo.rt.race?.at === T0 + 15000 && bo.rt.race.mine === 'offered' && bo.notes.some((n) => /calls a race on TEST: Dune Loop/.test(n) && /\/race/.test(n)), `6: the member hears it, offered on the message line ("${bo.notes[bo.notes.length - 1]}")`);
  const joined = await bo.rt.joinNow();
  deliver();
  ok(bo.runs[0]?.slot === 1 && bo.rt.race?.mine === 'joined' && /slot 2/.test(joined) && ana.notes.some((n) => /Bo is on the grid/.test(n)), `6: the member joins into slot 2 ("${joined}") and the leader is told`);
  ok(cleanRace({ phase: 'call', world: 'tatooine', track: loop.id, at: T0 + 15000, digest: trackDigest(loop), laps: 3, members: [7, 3] }) !== undefined, '6: every word on the way was one the relay keeps');
  // A word from a member who is not the leader calling a race of their own is no call.
  bo.rt.handle({ t: 'race', id: 3, phase: 'call', world: 'tatooine', track: loop.id, at: T0 + 99000, digest: trackDigest(loop), laps: 3, members: [3] });
  ok(bo.rt.race?.at === T0 + 15000, '6: a call that is not the leader\'s changes nothing');
  // The race: laps and the finish.
  clock = T0 + 80000;
  ana.rt.ranLap(1, 61.5, 61.5);
  bo.rt.ranLap(1, 63, 63);
  deliver();
  ana.rt.ranLap(2, 60, 121.5);
  bo.rt.ranLap(2, 59, 122);
  deliver();
  ana.rt.ranLap(3, 59.5, 181);
  ana.rt.ranFinish(181);
  deliver();
  bo.rt.ranLap(3, 58, 180);
  bo.rt.ranFinish(180);
  deliver();
  const anaBoard = ana.rt.lines();
  const boBoard = bo.rt.lines();
  ok(anaBoard[0] === '1 Bo 3:00.0' && anaBoard[1] === '2 Ana (you) 3:01.0' && boBoard[0] === '1 Bo (you) 3:00.0' && boBoard[1] === '2 Ana 3:01.0', `6: both browsers show the same standings, each marking its own (${anaBoard.join(' | ')} / ${boBoard.join(' | ')})`);
  ok(ana.notes.some((n) => /Bo finished 1st in 3:00.0/.test(n)) && bo.notes.some((n) => /Ana: lap 1\/3/.test(n)), '6: each lap and each finish of the other is said on the message line');
  // A second race: the member drops out of the vehicle mid-race, and the leader is told.
  clock = T0 + 300000;
  ana.rt.call(loop.id, 10);
  await Promise.resolve();
  await Promise.resolve();
  deliver();
  await bo.rt.joinNow();
  deliver();
  bo.rt.ranOut('you got off');
  deliver();
  ok(ana.notes.some((n) => /Bo is out of the race \(got off\)/.test(n)) && ana.rt.lines().some((l) => /Bo out/.test(l)), '6: a member who gets off drops out, and the rest are told');
  // A third: the member leaves the group, and the leader's roster says so.
  clock = T0 + 600000;
  ana.rt.call(loop.id, 10);
  await Promise.resolve();
  await Promise.resolve();
  deliver();
  await bo.rt.joinNow();
  deliver();
  roster.splice(1, 1);
  ana.rt.rosterChanged();
  ok(ana.notes.some((n) => /Bo left the group and is out of the race/.test(n)), '6: a member who leaves the group drops out, and the leader is told by its own roster');
  // A fourth, the member back in the group and riding nothing that races the track: offered it all the same (they may yet
  // get on something before go) and told why as it is offered, then joining once they can.
  roster.splice(1, 0, { id: 3, name: 'Bo', leader: false });
  clock = T0 + 900000;
  bo.rt.canRace = () => 'ride a pod first';
  ana.rt.call(loop.id, 10);
  await Promise.resolve();
  await Promise.resolve();
  deliver();
  // The newest offer (the leader's own word that it is on the grid comes after it).
  const offer = bo.notes.filter((n) => /calls a race on/.test(n)).pop() ?? '';
  ok(bo.rt.race?.mine === 'offered' && bo.rt.race.at === T0 + 910000 && /calls a race on TEST: Dune Loop/.test(offer) && /ride a pod first/.test(offer) && /\/race/.test(offer), `6: a member riding nothing that races it is offered the race all the same and told why ("${offer}")`);
  bo.rt.canRace = () => '';
  const late = await bo.rt.joinNow();
  ok(/slot 2/.test(late) && bo.rt.race?.mine === 'joined', `6: and joins once on something that races it ("${late}")`);
  // With no server carrying races, nothing is called and the words say why.
  const old = member(9, 'Cy', true);
  old.rt.raceVersion = () => 0;
  ok(/restart/.test(old.rt.call(loop.id)), '6: against a server whose hail carries no races, no race is called, and the words say to restart it');
}

// --- 7: the nudge between pods ----------------------------------------------------------------------------------------
{
  const d = new RaceDrive('pod', { ground: null });
  const priv = d as unknown as { nudgeFrom(): void; sPx: number; sPz: number; heading: number };
  priv.sPx = 0;
  priv.sPz = 0;
  priv.heading = 0;
  const near = d.near;
  // At heading nought the right is -x: a ride 6 m to the right pushes the stick left (below nought).
  near.n = 1;
  near.x[0] = -6;
  near.z[0] = 2;
  priv.nudgeFrom();
  const right = d.nudged;
  near.x[0] = 6;
  priv.nudgeFrom();
  const left = d.nudged;
  ok(right < 0 && left > 0 && Math.abs(right + left) < 1e-12, `7: a ride drawn on the right nudges the turn left (${r3(right)}), on the left right (${r3(left)})`);
  near.x[0] = -(RACE_TUNE.nudgeReach + 1);
  near.z[0] = 0;
  priv.nudgeFrom();
  ok(d.nudged === 0, `7: past the reach (${RACE_TUNE.nudgeReach} m) nothing`);
  near.x[0] = -0.5;
  near.z[0] = 0;
  priv.nudgeFrom();
  ok(Math.abs(d.nudged + RACE_TUNE.nudgeStick * (1 - 0.5 / RACE_TUNE.nudgeReach)) < 1e-12, `7: right beside it, the most of the stick it takes (${r3(d.nudged)} of ${RACE_TUNE.nudgeStick})`);
  near.x[0] = 0;
  near.z[0] = 8;
  priv.nudgeFrom();
  ok(d.nudged === 0, '7: one straight ahead, on no side, pushes nothing');
}

console.log(`\nraceTogether: ${checks} checks passed`);
