// The terminal, the ticket, the collector, and the shuttle's own clock.
//
// The clock is the interesting half: it has to come out of the wall clock and a name and nothing
// else, because two people standing at one starport have to watch the same shuttle land at the same
// instant with nothing sent between their browsers. That is checked by running it, not argued.
//
// Run: node tools/swg/tests/travelTerminal.test.ts

import assert from 'node:assert/strict';
import { TRAVEL_TUNE, canBoard, shuttleAt, shuttleWords, slotHash, thingAt, travelThingsOf, type TravelRow, type TravelThing } from '../../../src/world/travelTerminal.ts';

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
  const out = travelThingsOf([row({ cell: 4, x: -2.74, y: 0.64, z: 48.17, bx: 100, bz: 200 })], { x: 0, z: 0 });
  ok(out[0].cell === 4 && out[0].x === -2.74 && out[0].z === 48.17, "a thing inside a building keeps the building's own frame, which is the frame its room is drawn in");
  ok(out[0].bx === -100, 'while the building itself is still brought over, since that is what ties a terminal to its port');
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

note(`every number of the timetable is ours: a round of ${TRAVEL_TUNE.every}s, a wait of ${TRAVEL_TUNE.waits}s, ${TRAVEL_TUNE.glide}s to come down; nothing in the archives says what the game's were`);

console.log(`\n${passed} checks passed`);
