// The terminal, the ticket, the collector, and the shuttle's own clock.
//
// The clock is the interesting half: it has to come out of the wall clock and a name and nothing
// else, because two people standing at one starport have to watch the same shuttle land at the same
// instant with nothing sent between their browsers. That is checked by running it, not argued.
//
// Run: node tools/swg/tests/travelTerminal.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TICKETS_HELD, TRAVEL_PACK_VERSION, TRAVEL_TUNE, addTicket, canBoard, collectorWords, pickTicket, rigPose, rigTimes, shuttleAt, shuttleWords, slotHash, thingAt, ticketText, travelPackReadable, travelThingAt, travelThingsOf, type RigPose, type Ticket, type TravelRow, type TravelThing } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const row = (over: Partial<TravelRow> = {}): TravelRow => ({ kind: 'terminal', building: 'b', cell: 0, x: 0, y: 0, z: 0, yaw: 0, bx: 0, by: 0, bz: 0, byaw: 0, ...over });

// ---------------------------------------------------------------- the frame

{
  const out = travelThingsOf([row({ cell: 0, x: 100, z: 200, bx: 100, bz: 200 })], { x: 10, z: 20 });
  ok(out[0].x === -90 && out[0].z === 180, 'a thing out in the open is mirrored and centred exactly as the streamer does it');
  ok(out[0].bx === -90 && out[0].bz === 180, 'and so is the building it belongs to');
}

{
  // The one that was wrong. A thing inside a building is written in the building's own frame, and
  // the only thing it is ever measured against is the player, who is in the world's frame in any
  // room that is not a ship's. Left where it was written, a starport's terminal read as a few
  // metres from the world's origin -- kilometres from the port it stands in -- so no starport ever
  // offered one, while the shuttleports, whose terminals stand outside, worked perfectly.
  const out = travelThingsOf([row({ cell: 4, x: -2.74, y: 0.64, z: 48.17, bx: 100, by: 28, bz: 200 })], { x: 0, z: 0 });
  ok(Math.abs(out[0].x - (-100 + 2.74)) < 1e-9 && Math.abs(out[0].z - (200 + 48.17)) < 1e-9, 'a thing inside a building comes out in the world, where the player is');
  ok(Math.abs(out[0].y - 28.64) < 1e-9, "and at the building's own height plus its own, not at the room's local height");
  ok(out[0].cell === 4 && out[0].bx === -100, 'it keeps its room, and the building is brought over, which is what ties a terminal to its port');
}

{
  // The mirror and the turn are not guessed: they are whatever makes an indoor child of a building
  // land where an outdoor child of the same building at the same local place lands. The converter
  // composed the outdoor one in snapshot space and this file mirrors that as a whole, so the two
  // paths meeting is the check. The first way it was written -- mirror the local point, then turn
  // it by the mirrored yaw -- passes at a building facing straight on and is wrong at every other,
  // which is why this sweeps the turn rather than checking one.
  for (const byaw of [0, 0.4, -1.1, 2.7, Math.PI]) {
    const local = { x: -3.5, y: 0.64, z: 12.25 };
    const cos = Math.cos(byaw);
    const sin = Math.sin(byaw);
    // What the converter writes for a child of this building standing outside it, at that place.
    const outdoor = row({ cell: 0, x: 100 + (local.x * cos + local.z * sin), y: 28 + local.y, z: 200 + (-local.x * sin + local.z * cos), bx: 100, by: 28, bz: 200, byaw });
    const indoor = row({ cell: 4, x: local.x, y: local.y, z: local.z, bx: 100, by: 28, bz: 200, byaw });
    const [a, b] = travelThingsOf([outdoor, indoor], { x: 10, z: 20 });
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6, `at a building turned ${byaw.toFixed(2)} the indoor and outdoor paths put the same place in the same spot`);
  }
  passed++;
  console.log('ok   and an indoor child lands exactly where an outdoor one at the same local place does, at every turn');
}

// ---------------------------------------------------------------- standing at one

{
  const things: TravelThing[] = [
    { kind: 'terminal', x: 0, y: 0, z: 0, yaw: 0, cell: 4, building: 'starport', bx: 0, bz: 0 },
    { kind: 'terminal', x: 0, y: 0, z: 0, yaw: 0, cell: 4, building: 'shuttleport', bx: 900, bz: 0 },
    { kind: 'collector', x: 20, y: 0, z: 0, yaw: 0, cell: 0, building: 'starport', bx: 0, bz: 0 },
  ];
  // The trap this room test exists for: two ports on one world are the same building, so their
  // terminals carry the very same numbers. Without the room, standing in one would offer the other.
  const inStar = thingAt(things, { x: 0.5, y: 0, z: 0.5 }, { building: 'starport', cell: 4 }, 'terminal');
  ok(inStar?.building === 'starport', 'standing in one starport reaches that starport\'s terminal');
  const inShuttle = thingAt(things, { x: 0.5, y: 0, z: 0.5 }, { building: 'shuttleport', cell: 4 }, 'terminal');
  ok(inShuttle?.building === 'shuttleport', "and standing in the other reaches the other's, although the numbers are identical");
  ok(thingAt(things, { x: 0.5, y: 0, z: 0.5 }, { building: 'starport', cell: 5 }, 'terminal') === null, 'a different room in the same building reaches neither');
  ok(thingAt(things, { x: 0.5, y: 0, z: 0.5 }, null, 'terminal') === null, 'and standing outside reaches nothing indoors');
}

{
  const things: TravelThing[] = [{ kind: 'collector', x: 0, y: 0, z: 0, yaw: 0, cell: 0, building: 'b', bx: 0, bz: 0 }];
  ok(thingAt(things, { x: 1, y: 0, z: 1 }, null, 'collector')?.kind === 'collector', 'a collector out in the open is reached from beside it');
  ok(thingAt(things, { x: TRAVEL_TUNE.reach + 2, y: 0, z: 0 }, null, 'collector') === null, 'and not from across the landing pad');
  ok(thingAt(things, { x: 1, y: 0, z: 1 }, null, 'terminal') === null, 'and a collector is not a terminal, however near you stand');
  ok(thingAt(things, { x: 0, y: 20, z: 0 }, null, 'collector') === null, 'nor is one on another floor reached through it');
}

{
  // Theed's collector stands in the hangar (cell 5), the only one in the game that is indoors. E was
  // asked for collectors only as if they stood outside, so that one was never offered from anywhere.
  // The places are the hangar's own: its terminals stand 55 m from its collector, well past the reach.
  const things: TravelThing[] = [
    { kind: 'collector', x: -10, y: 13.9, z: 10, yaw: 0, cell: 5, building: 'theed', bx: 0, bz: 0 },
    { kind: 'collector', x: 60, y: 0, z: 0, yaw: 0, cell: 0, building: 'port', bx: 60, bz: 0 },
    { kind: 'terminal', x: -9.5, y: 13.9, z: -45.2, yaw: 0, cell: 5, building: 'theed', bx: 0, bz: 0 },
  ];
  const hangar = { building: 'theed', cell: 5 };
  ok(travelThingAt(things, { x: -9, y: 13.9, z: 10 }, hangar)?.kind === 'collector', 'a collector standing in the room with you is reached, as Theed\'s in its hangar must be');
  ok(travelThingAt(things, { x: -9.5, y: 13.9, z: -44 }, hangar)?.kind === 'terminal', 'and the terminals across the same hangar are still reached from beside them');
  ok(travelThingAt(things, { x: -9, y: 0, z: 10 }, null) === null, 'and from the street outside the hangar the indoor collector is not offered through the wall');
  ok(travelThingAt(things, { x: 61, y: 0, z: 0 }, null)?.building === 'port', 'while an outdoor collector is reached from beside it, as every other starport\'s is');
}

// ---------------------------------------------------------------- the shuttle's clock

{
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(slotHash('corellia starport', i).toFixed(6));
  ok(seen.size > 190, 'the slot hash spreads: two hundred slots give two hundred different moments');
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < 2000; i++) {
    const v = slotHash(`port ${i}`, 0);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  ok(lo >= 0 && hi < 1 && lo < 0.01 && hi > 0.99, 'and it fills the whole of nought to one');
}

{
  // The one thing that matters: the same name and the same instant give the same answer, always.
  for (const t of [0, 13.5, 299, 1234.75, 98765.2]) {
    const a = shuttleAt('corellia starport', t);
    const b = shuttleAt('corellia starport', t);
    assert.deepEqual(a, b, `the clock is the same answer twice at ${t}`);
  }
  passed++;
  console.log('ok   two browsers reading the same clock at the same instant see the same shuttle');
  // And they do not all land together. Two named ports could agree by coincidence, so what is
  // checked is the real property: over many ports at one instant, the waits spread right across the
  // round rather than bunching at one moment.
  const untils = Array.from({ length: 200 }, (_, i) => shuttleAt(`port ${i}`, 500).until);
  const spread = Math.max(...untils) - Math.min(...untils);
  const phases = new Set(Array.from({ length: 200 }, (_, i) => shuttleAt(`port ${i}`, 500).phase));
  ok(spread > TRAVEL_TUNE.every * 0.5, `two hundred ports at one instant are spread over ${Math.round(spread)}s of waiting, so they do not all land together`);
  ok(phases.size >= 2, `and at any one moment some are here and some are not (${[...phases].join(', ')})`);
}

{
  // Walk a whole round a second at a time: it must land, wait, leave and go away, in that order,
  // and it must be boardable for exactly as long as it waits.
  const seen: string[] = [];
  let waiting = 0;
  for (let t = 0; t < TRAVEL_TUNE.every * 2; t += 0.5) {
    const s = shuttleAt('a port', t);
    if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
    if (s.phase === 'waiting') waiting += 0.5;
  }
  ok(seen.includes('landing') && seen.includes('waiting') && seen.includes('leaving') && seen.includes('away'), `a round goes through every phase (${seen.join(' → ')})`);
  ok(Math.abs(waiting - TRAVEL_TUNE.waits * 2) < 2, `and it can be boarded for about as long as it waits, twice over two rounds (${waiting}s)`);
  const order = seen.join(',');
  ok(!/waiting,landing/.test(order), 'and it never goes straight from waiting back to landing without leaving');
}

{
  for (let t = 0; t < 4000; t += 3.7) {
    const s = shuttleAt('x', t);
    assert.ok(s.until >= 0 && s.left >= 0 && s.glide >= 0 && s.glide <= 1, `the clock never answers nonsense at ${t.toFixed(1)}`);
    assert.ok(s.phase !== 'waiting' || s.until === 0, 'and a shuttle you can board is not also a shuttle you are waiting for');
  }
  passed++;
  console.log('ok   and it never answers nonsense at any moment of any round');
}

{
  const waitingNow = { phase: 'waiting' as const, until: 0, left: 30, glide: 1 };
  const away = { phase: 'away' as const, until: 120, left: 0, glide: 0 };
  ok(shuttleWords(waitingNow).includes('here'), 'a shuttle that is here says so');
  ok(shuttleWords(away).includes('2m'), 'and one that is not says how long, in minutes where there are any');
  ok(shuttleWords({ ...away, until: 20 }).includes('20s'), 'and in seconds where there are not');
}

// ---------------------------------------------------------------- a shuttle drawn on its rig

{
  // The transport's own lengths: 26.6 s to come down and 20 s to go up. The round is timed by them, and
  // the pose is where in which clip the rig is, so what is drawn and what the collector says agree.
  const times = { land: 26.6, lift: 19.97 };
  const pose: RigPose = { role: 'sky', seconds: 0, shown: false };
  let landingFor = 0;
  let liftingFor = 0;
  let lastLand = -1;
  let forward = true;
  let groundWhileBoardable = true;
  for (let t = 0; t < TRAVEL_TUNE.every * 3; t += 0.25) {
    const s = shuttleAt('a starport', t, TRAVEL_TUNE, times);
    rigPose(s, times, pose);
    if (s.phase === 'landing') {
      landingFor += 0.25;
      if (pose.role !== 'land' || pose.seconds < lastLand - 1e-9) forward = false;
      lastLand = pose.seconds;
    } else lastLand = -1;
    if (s.phase === 'leaving') liftingFor += 0.25;
    if (s.phase === 'waiting' && (pose.role !== 'ground' || !pose.shown)) groundWhileBoardable = false;
    if (s.phase === 'away' && pose.shown) groundWhileBoardable = false;
  }
  ok(Math.abs(landingFor - times.land * 3) < 1.5 && Math.abs(liftingFor - times.lift * 3) < 1.5, `the round takes the rig's own landing and lift-off (${(landingFor / 3).toFixed(1)} s and ${(liftingFor / 3).toFixed(1)} s a round)`);
  ok(forward, 'and plays its landing forward from the start, never back');
  ok(groundWhileBoardable, 'it stands on the ground for exactly as long as it can be boarded, and is drawn nowhere while it is away');
  const mid = rigPose({ phase: 'leaving', until: 0, left: 0, glide: 0.25 }, times, pose);
  ok(mid.role === 'lift' && Math.abs(mid.seconds - 0.75 * times.lift) < 1e-9, 'three quarters of the way through leaving is three quarters of the way through the lift-off clip');
  ok(rigTimes(null, '') === null && rigTimes({ file: 'r', parts: [], moods: { calm: { land: 'l', lift: 't' } }, seconds: { l: 26.6, t: 20 } }, 'theed')?.land === 26.6, "a rig's times are its clips' lengths, falling back on its first branch");
  assert.deepEqual(shuttleAt('a port', 1234), shuttleAt('a port', 1234, TRAVEL_TUNE, null));
  ok(true, 'and a shuttle with no rig keeps the round it always had');
  ok(travelPackReadable(1) && travelPackReadable(2) && travelPackReadable(3) && !travelPackReadable(4) && !travelPackReadable(undefined), 'a pack of any version from before the rigs is still read, so an install that has not converted again keeps its terminals');
  const cli = readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  const written = Number(/const TRAVEL_PACK_VERSION = (\d+);/.exec(cli)?.[1]);
  ok(written === TRAVEL_PACK_VERSION, `and the version the converter writes is the one the game reads (${written} and ${TRAVEL_PACK_VERSION})`);
}

// ---------------------------------------------------------------- boarding

{
  const waitingNow = { phase: 'waiting' as const, until: 0, left: 30, glide: 1 };
  const away = { phase: 'away' as const, until: 120, left: 0, glide: 0 };
  const ticket = { from: 'corellia', pack: 'naboo', to: 'Theed Starport', at: null, price: 1000, bought: 0 };
  ok(canBoard(ticket, 'corellia', waitingNow).ok, 'a ticket from this world, with the shuttle here, boards');
  ok(!canBoard(ticket, 'corellia', away).ok, 'and the same ticket with no shuttle does not');
  ok(canBoard(ticket, 'corellia', away).why.includes('away'), 'and says how long to wait');
  ok(!canBoard(null, 'corellia', waitingNow).ok, 'no ticket boards nothing, however punctual the shuttle');
  const wrong = canBoard(ticket, 'naboo', waitingNow);
  ok(!wrong.ok && wrong.why.includes('corellia'), 'and a ticket bought somewhere else says where it was bought');
}

// ---------------------------------------------------------------- more than one ticket

{
  const t = (id: string, from = 'corellia', to = `port ${id}`): Ticket => ({ id, from, pack: 'naboo', to, at: null, price: 1000, bought: Number(id.slice(1)) });
  let held: Ticket[] = [];
  held = addTicket(held, t('t1'));
  held = addTicket(held, t('t2'));
  ok(held.length === 2, 'two tickets bought are two tickets held, which is the whole of it');
  held = addTicket(held, { ...t('t2'), to: 'somewhere else' });
  ok(held.length === 2 && held[1].to === 'somewhere else', 'and one bought again under the same number replaces it rather than doubling');
  let many: Ticket[] = [];
  for (let i = 0; i < TICKETS_HELD + 5; i++) many = addTicket(many, t(`t${i}`));
  ok(many.length === TICKETS_HELD, `the cap holds at ${TICKETS_HELD}`);
  ok(many[0].id === `t5`, 'and the oldest is the one that goes, never the newest');
}

{
  const t = (id: string, from: string): Ticket => ({ id, from, pack: 'naboo', to: `to ${id}`, at: null, price: 1, bought: 0 });
  const held = [t('a', 'corellia'), t('b', 'tatooine'), t('c', 'corellia')];
  ok(pickTicket(held, 'c', 'corellia')?.id === 'c', 'the ticket the player picked is the one the collector takes');
  ok(pickTicket(held, 'b', 'corellia')?.id === 'a', "a pick that is no good from here is stepped over for the oldest that is, rather than refusing everything");
  ok(pickTicket(held, '', 'corellia')?.id === 'a', 'and somebody who never opens the list is served in the order they bought');
  ok(pickTicket(held, '', 'naboo') === null, 'nowhere to go from a world none of them is from');
  ok(pickTicket([], 'a', 'corellia') === null, 'and no tickets is no ticket');
  ok(ticketText(held[0], 'corellia').includes('collector'), 'a ticket from here says where it is handed in');
  ok(ticketText(held[1], 'corellia').includes('tatooine'), 'and one from elsewhere says where it was bought');
}

{
  // The words at the collector: the one place a shuttle's own clock is ever shown, so pressing at
  // the right moment must not look the same as pressing at the wrong one.
  const ticket: Ticket = { id: 'a', from: 'corellia', pack: 'naboo', to: 'Theed', at: null, price: 1, bought: 0 };
  const waitingNow = { phase: 'waiting' as const, until: 0, left: 42, glide: 1 };
  const away = { phase: 'away' as const, until: 90, left: 0, glide: 0 };
  const there = collectorWords(ticket, 'corellia', waitingNow);
  ok(there.can && there.text.includes('Theed') && there.text.includes('42'), 'with a shuttle there it offers the journey and says how long it stays');
  const not = collectorWords(ticket, 'corellia', away);
  ok(!not.can && not.text.includes('1m'), 'with none there it says how long to wait, which is the only way to know one is coming');
  const noTicket = collectorWords(null, 'corellia', waitingNow);
  ok(!noTicket.can && noTicket.text.includes('no ticket') && noTicket.text.includes('here'), 'with no ticket it says both: what is missing and that a shuttle is waiting');
}

// ------------------------------------------------- the real packs, if this install has them

// The check that would have caught it, over every pack this install has converted.
//
// A fixture agrees with whatever arithmetic wrote it, so the witness has to be an invariant: the
// transform is a mirror and a turn, both rigid, so **however a thing is brought over, it must end
// up exactly as far from its own building as it was written from it**. Left in the room's own
// frame a starport terminal is 48 m from the world's origin and some thousands from its own port,
// which this catches with no threshold to argue about. The distance itself is then printed, which
// is what says a terminal really is inside the building rather than merely consistent with it.
{
  const packs = join(process.cwd(), 'assets-private');
  const worlds = existsSync(packs) ? readdirSync(packs).filter((w) => existsSync(join(packs, w, 'travel.json'))) : [];
  if (!worlds.length) {
    note('no converted world carries a travel.json, so the real packs are not checked: npm run swg -- travel assets-private');
  } else {
    let indoors = 0;
    let worst = 0;
    let worstWhere = '';
    for (const world of worlds) {
      const pack = JSON.parse(readFileSync(join(packs, world, 'travel.json'), 'utf8')) as { rows: TravelRow[] };
      const rows = (pack.rows ?? []).filter((r) => r.cell > 0);
      // The centre is nothing to do with it: both the thing and its building take the same one, so
      // the distance between them must come out the same whatever it is. It is swept to say so.
      for (const centre of [{ x: 0, z: 0 }, { x: -1234.5, z: 678.25 }]) {
        const things = travelThingsOf(rows, centre);
        things.forEach((t, i) => {
          const r = rows[i];
          const was = Math.hypot(r.x, r.z);
          const now = Math.hypot(t.x - t.bx, t.z - t.bz);
          assert.ok(Math.abs(now - was) < 1e-6, `${world}: a ${t.kind} written ${was.toFixed(2)} m from its building came out ${now.toFixed(2)} m from it`);
          assert.ok(Math.abs(t.y - (r.by + r.y)) < 1e-9, `${world}: a ${t.kind} must stand at its building's height plus its own`);
          if (centre.x === 0 && now > worst) {
            worst = now;
            worstWhere = `${world}, a ${t.kind} in cell ${t.cell}`;
          }
        });
        indoors += centre.x === 0 ? things.length : 0;
      }
    }
    if (indoors) {
      passed++;
      console.log(`ok   every one of ${indoors} indoor travel things over ${worlds.length} converted worlds stays exactly where it was written relative to its own building (furthest out ${worst.toFixed(1)} m, ${worstWhere})`);
    } else note(`${worlds.length} converted worlds and not one indoor travel thing between them, so nothing was measured`);
  }
}

note(`every number of the timetable is ours: a round of ${TRAVEL_TUNE.every}s, a wait of ${TRAVEL_TUNE.waits}s, ${TRAVEL_TUNE.glide}s to come down; nothing in the archives says what the game's were`);

console.log(`\n${passed} checks passed`);
