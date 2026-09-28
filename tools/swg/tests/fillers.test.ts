// The people of ours in the buildings the data leaves empty (src/world/ambient/fillers.ts): which kinds of
// building they stand in and how many of them, the rule that says a building is the data's (anybody of
// the data's standing inside its box) and not ours to fill, which way a seat faces, the seats taken first
// and the open floor after, and a place's life -- somebody in it, somebody leaving, nobody, somebody new.
// Every building here is drawn by hand; the clock and the draws are the test's own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildFloor } from '../../../src/world/nav/navMesh.ts';
import { fitsAt } from '../../../src/world/nav/navMesh.ts';
import {
  FILLER_TUNE,
  buildingSeed,
  fillCount,
  fillKindOf,
  furnish,
  isSeat,
  leaveSlot,
  leftEmpty,
  openSlot,
  oursAllowedOn,
  planSpots,
  seatHeading,
  stepSlot,
  throughMatrix,
  type DataPlace,
  type FillSlot,
  type FloorRoom,
  type Furnishing,
  type SeatCandidate,
} from '../../../src/world/ambient/fillers.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

// ---- 1: which buildings, and how many --------------------------------------------------------------
{
  const kinds: [string, string | null][] = [
    ['object/building/tatooine/shared_cantina_tatooine.iff', 'cantina'],
    ['object/building/military/shared_military_base_shed_imperial_style_cantina_s01.iff', 'cantina'],
    ['object/building/restuss/shared_restuss_faction_cantina.iff', 'cantina'],
    ['object/building/corellia/shared_bank_corellia.iff', 'bank'],
    ['object/building/naboo/shared_hotel_naboo_theed.iff', 'hotel'],
    ['object/building/tatooine/shared_cloning_facility_tatooine.iff', 'medical'],
    ['object/building/corellia/shared_hospital_corellia_s02.iff', 'medical'],
    ['object/building/naboo/shared_guild_theater_naboo_s01.iff', 'theater'],
    ['object/building/naboo/shared_guild_combat_naboo_style_01.iff', 'guild'],
    ['object/building/tatooine/shared_capitol_tatooine.iff', 'capitol'],
    ['object/building/corellia/shared_association_hall_civilian_corellia.iff', 'association'],
    ['object/building/tatooine/shared_starport_tatooine.iff', 'starport'],
    ['object/building/tatooine/shared_housing_tatt_style01_small.iff', 'house'],
    ['object/building/player/shared_player_house_corellia_small_style_01.iff', 'house'],
    ['object/building/military/shared_military_outpost_guard_house_imperial.iff', null],
    ['object/building/military/shared_military_base_gate_house_rebel.iff', null],
    ['object/building/tatooine/shared_shuttleport_tatooine.iff', null],
    ['home:17', null],
    ['object/tangible/furniture/elegant/shared_chair_s01.iff', null],
  ];
  const wrong = kinds.filter(([t, k]) => fillKindOf(t) !== k);
  ok(!wrong.length, `each kind of building by its template, a guild's theatre a theatre, a guard house and a gate house nobody's home, a shuttleport and a player's own house (\`home:\`) none of ours: ${wrong.map(([t]) => t).join(', ') || 'all right'}`);
  ok(!oursAllowedOn('kashyyyk_main') && !oursAllowedOn('kashyyyk_rryatt_trail') && !oursAllowedOn('mustafar') && !oursAllowedOn('') && oursAllowedOn('tatooine') && oursAllowedOn('naboo'), 'none of ours on Kashyyyk or Mustafar (the owner’s D13), nor on a world with no name');
  let inRange = true;
  const houses = [0, 0];
  const cantinas = new Set<number>();
  for (let s = 0; s < 2000; s++) {
    const seed = buildingSeed('object/building/x.iff', s * 7.3, -s * 3.1);
    for (const kind of ['cantina', 'starport', 'hotel', 'medical', 'bank', 'guild', 'theater', 'capitol', 'association', 'house'] as const) {
      const n = fillCount(kind, seed);
      if (n < FILLER_TUNE[kind][0] || n > FILLER_TUNE[kind][1]) inRange = false;
    }
    houses[fillCount('house', seed)]++;
    cantinas.add(fillCount('cantina', seed));
  }
  ok(inRange, 'how many of ours a building holds is always within its kind’s range: a cantina six to ten, a bank two or three, a house none or one (the design’s numbers)');
  ok(houses[0] > 800 && houses[1] > 800 && cantinas.size === 5, `a house has one of ours about half the time (${houses[1]} of 2000), and a cantina every count from six to ten comes up`);
  ok(fillCount('cantina', buildingSeed('a', 1, 2)) === fillCount('cantina', buildingSeed('a', 1.4, 2.3)), "a building's seed is its template and its place rounded: the same in every browser");
}

// ---- 2: the building is the data's, or ours to fill -------------------------------------------------
{
  // A building turned a quarter about the upright and standing at (100, 0, 50), placed as three places
  // it: the rule is handed the inverse's own sixteen numbers, as the game hands it `Building.inverse`.
  const matrix = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(100, 0, 50);
  const inverse = matrix.clone().invert();
  const building = (bounds = { min: [-10, -1, -8], max: [10, 6, 8] }) => ({ x: 100, z: 50, radius: 12, bounds, inverse: inverse.elements });
  // The data's own people as `StandingPeople.anyStanding` asks after them: the rows within `reach` of a
  // point on either axis, each handed to the rule.
  const people = (list: DataPlace[]) => ({
    anyStanding(x: number, z: number, reach: number, inside: (st: DataPlace) => boolean): boolean {
      for (const st of list) {
        if (Math.abs(st.x - x) > reach || Math.abs(st.z - z) > reach) continue;
        if (inside(st)) return true;
      }
      return false;
    },
  });
  // Its own frame, worked out by hand: a quarter turn takes local (x, z) to the world's (100 + z, 50 - x).
  const w = { x: 0, y: 0, z: 0 };
  let agree = 0;
  for (let k = 0; k < 50; k++) {
    const p = new THREE.Vector3(80 + k * 0.9, (k % 7) - 2, 30 + k * 0.7);
    throughMatrix(inverse.elements, p.x, p.y, p.z, w);
    const want = p.clone().applyMatrix4(inverse);
    if (near(w.x, want.x, 1e-9) && near(w.y, want.y, 1e-9) && near(w.z, want.z, 1e-9) && near(w.x, -(p.z - 50), 1e-9) && near(w.z, p.x - 100, 1e-9)) agree++;
  }
  ok(agree === 50, `a place is carried into a building's own frame exactly as three carries it (${agree} of 50)`);
  ok(leftEmpty(building(), people([])), 'with nobody of the data’s near it, a building is empty and ours to fill');
  ok(!leftEmpty(building(), people([{ x: 100 + 7, y: 1, z: 50 - 9, inside: true }])), 'one of the data’s people stood in a room, standing in its turned box, makes it the data’s');
  ok(leftEmpty(building(), people([{ x: 100 + 7, y: 1, z: 50 - 9, inside: false }])), '... but one the data stood out in the open does not, however far into the box it reaches: a vendor at the door, a guard on the porch');
  ok(leftEmpty(building(), people([{ x: 100 + 7, y: 1, z: 50 - 11.5, inside: true }])), '... and nor does one standing in the next building along, beside its box');
  ok(!leftEmpty(building(), people([{ x: 100 + 7, y: 1, z: 50 - 10.9, inside: true }])), `the box is grown ${FILLER_TUNE.dataGrow} m, for a person the converter put a hand’s breadth out of their room`);
  ok(leftEmpty(building(), people([{ x: 110, y: 1, z: 50, inside: true }])) && !leftEmpty(building(), people([{ x: 100, y: 1, z: 60.5, inside: true }])), 'measured in the building’s own frame, turned: ten metres off its middle along the world’s x is past its short side, and ten and a half along z is within its long one');
  ok(!leftEmpty(building({ min: [10, 6, 8], max: [-10, -1, -8] }), people([{ x: 100, y: 1, z: 50, inside: true }])), 'and its box is read whichever corner the pack wrote first');
  // The game uses exactly this rule, and leaves a building the data has people in to the data.
  const runner = readFileSync(new URL('../../../src/world/ambient/ambientPeople.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const plan = runner.slice(runner.indexOf('  private planBuilding('), runner.indexOf('\n  }\n', runner.indexOf('  private planBuilding(')));
  ok(/inverse: b\.inverse\.elements/.test(plan) && /if \(!leftEmpty\(frame, deps\.people\)\) \{\s*f\.why = [^;]+;\s*return f;\s*\}/.test(plan) && plan.indexOf('leftEmpty(') < plan.indexOf('f.empty = true;'), 'the game decides a building is the data’s by this very rule, over its own inverse, and stands nobody of ours in it');
  ok(/furnish\(this\.contained, /.test(plan) && /planSpots\(seats, rooms, avoid, count, seed\)/.test(plan), '... and reads its furniture by the rule below, and plans its places from what that finds');
}

// ---- 2b: a building's furniture -----------------------------------------------------------------------
{
  const still = { x: 0, y: 0, z: 0, w: 1 };
  const quarter = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  const objects: Furnishing[] = [
    { x: 1, y: 0, z: 1, template: 'object/tangible/furniture/elegant/shared_chair_s01.iff', q: still },
    { x: 2, y: 0, z: 2, template: 'object/tangible/furniture/all/shared_frn_all_table_s01.iff', q: still },
    { x: 3, y: 5, z: 3, template: 'object/tangible/furniture/elegant/shared_chair_s01.iff', q: still },
    { x: 50, y: 0, z: 50, template: 'object/tangible/furniture/elegant/shared_chair_s01.iff', q: still },
    { x: 4, y: 0, z: 4, template: 'object/tangible/furniture/all/shared_frn_all_couch_lg_s1.iff', q: quarter },
  ];
  // Room 1 the hall, room 2 a parlour, room 4 a lift shaft; the chair at (50, 50) stands in no room.
  const cellOf = (o: Furnishing): number => (o.x === 50 ? 0 : o.x === 3 ? 4 : o.x === 4 ? 2 : 1);
  const seats: SeatCandidate[] = [{ x: 9, y: 9, z: 9, heading: 0, cell: 9 }];
  const avoid = [{ x: 9, z: 9 }];
  furnish(objects, cellOf, new Set([4]), 0, seats, avoid);
  ok(seats.length === 2 && seats[0].x === 1 && seats[0].cell === 1 && near(seats[0].heading, 0) && seats[1].x === 4 && seats[1].cell === 2 && near(seats[1].heading, Math.PI / 2, 1e-9), 'the seats in its rooms are its seats, each facing its own +Z: never a table, never a chair in a lift shaft, never one standing outside');
  ok(avoid.length === 4 && !avoid.some((a) => a.x === 50) && avoid.some((a) => a.x === 2) && avoid.some((a) => a.x === 3), 'everything standing in its rooms is kept clear of, the table and the shaft’s chair among them, and nothing outside it');
  furnish(objects, cellOf, new Set([4]), 0.25, seats, avoid);
  ok(seats.length === 2 && near(seats[0].heading, 0.25), '... the lists emptied first, and the seat turn added');
}

// ---- 3: seats -----------------------------------------------------------------------------------------
{
  const seats = ['object/tangible/furniture/elegant/shared_chair_s01.iff', 'object/tangible/furniture/all/shared_frn_all_couch_lg_s1.iff', 'object/tangible/furniture/tatooine/shared_frn_tatt_chair_cantina_seat_3.iff', 'object/tangible/furniture/all/shared_frn_all_chair_kitchen_s1.iff', 'object/tangible/furniture/modern/shared_love_seat_modern_style_01.iff', 'object/tangible/furniture/all/shared_frn_all_couch_ottoman_s1.iff'];
  const not = ['object/tangible/furniture/all/shared_frn_all_table_s01.iff', 'object/tangible/furniture/all/shared_frn_all_lamp_free_s01.iff', 'object/tangible/furniture/all/shared_starship_pilot_chair.iff', 'object/tangible/terminal/shared_terminal_bank.iff'];
  ok(seats.every(isSeat) && !not.some(isSeat), 'a chair, a couch, a cantina booth, a kitchen chair, a love seat and an ottoman are seats; a table, a lamp, a pilot’s chair and a terminal are not');
  ok(near(seatHeading({ x: 0, y: 0, z: 0, w: 1 }), 0), 'an unturned seat faces +Z, which is measured: 443 of the 686 seats with a table beside them on the desert world face it along +Z, and 43 away');
  const s = Math.SQRT1_2;
  ok(near(seatHeading({ x: 0, y: s, z: 0, w: s }), Math.PI / 2, 1e-9), 'a seat turned a quarter about the upright faces +X, a body’s own heading convention');
  ok(near(seatHeading({ x: 0, y: 0, z: 0, w: 1 }, 0.5), 0.5), "`seatTurn` is added, for a turn the owner's eye finds wrong");
}

// ---- 4: where they stand -------------------------------------------------------------------------------
{
  // Two rooms drawn by hand in the building's own frame: a 10 m square hall and a 2 m square cupboard.
  const hall = buildFloor({ v: [0, 0, 0, 10, 0, 0, 10, 0, 10, 0, 0, 10], t: [0, 1, 2, 0, 2, 3] })!;
  const cupboard = buildFloor({ v: [20, 0, 0, 22, 0, 0, 22, 0, 2, 20, 0, 2], t: [0, 1, 2, 0, 2, 3] })!;
  const ident = (x: number, y: number, z: number, out: { x: number; y: number; z: number }): void => {
    out.x = x;
    out.y = y;
    out.z = z;
  };
  const rooms: FloorRoom[] = [
    { cell: 1, floor: hall, toWorld: ident },
    { cell: 2, floor: cupboard, toWorld: ident },
  ];
  const seats: SeatCandidate[] = [
    { x: 2, y: 0, z: 2, heading: 0, cell: 1 },
    { x: 8, y: 0, z: 2, heading: Math.PI / 2, cell: 1 },
    { x: 5, y: 0, z: 8, heading: Math.PI, cell: 1 },
  ];
  const avoid = [...seats.map((q) => ({ x: q.x, z: q.z })), { x: 5, z: 5 }];
  const two = planSpots(seats, rooms, avoid, 2, 1234);
  ok(two.length === 2 && two.every((p) => p.seat), 'with seats to spare, every place is a seat');
  const row: SeatCandidate[] = Array.from({ length: 8 }, (_, i) => ({ x: 1 + i, y: 0, z: 9, heading: Math.PI, cell: 1 }));
  const orders = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) orders.add(planSpots(row, [], [], 3, seed).map((p) => p.x).join(','));
  ok(JSON.stringify(planSpots(seats, rooms, avoid, 2, 1234)) === JSON.stringify(two) && orders.size > 6, `which seats are taken is drawn from the building's seed: the same in every browser, and ${orders.size} different threes of a row of eight over twelve buildings`);
  const seven = planSpots(seats, rooms, avoid, 7, 1234);
  const seat = seven.find((p) => p.seat && p.x === 8);
  ok(!!seat && near(seat.frontX, 8 + FILLER_TUNE.front) && near(seat.frontZ, 2, 1e-9), `each seat is walked to from ${FILLER_TUNE.front} m in front of it, the way it faces`);
  const onFloor = seven.filter((p) => !p.seat);
  ok(seven.slice(0, 3).every((p) => p.seat) && onFloor.length >= 1, `seats first, then open floor: ${seven.filter((p) => p.seat).length} seats and ${onFloor.length} on the floor for seven places`);
  // Where open floor goes, over two hundred buildings rather than one draw that happens to miss the
  // cupboard and the furniture; and the same count with the two rules taken away, so the check is one
  // that can fail.
  const census = (tune: typeof FILLER_TUNE, furnishings: { x: number; z: number }[]) => {
    const seen = { floor: 0, cupboard: 0, nearFurniture: 0, nearPlace: 0, walls: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const spots = planSpots(seats, rooms, furnishings, 7, seed, tune);
      for (const p of spots) {
        if (p.seat) continue;
        seen.floor++;
        if (p.cell === 2) seen.cupboard++;
        else if (!fitsAt(hall, p.x, p.y, p.z, FILLER_TUNE.clearance)) seen.walls++;
        if (avoid.some((a) => Math.hypot(p.x - a.x, p.z - a.z) < FILLER_TUNE.spacing - 1e-9)) seen.nearFurniture++;
        if (spots.some((q) => q !== p && Math.hypot(p.x - q.x, p.z - q.z) < FILLER_TUNE.spacing - 1e-9)) seen.nearPlace++;
      }
    }
    return seen;
  };
  const kept = census(FILLER_TUNE, avoid);
  ok(kept.floor >= 600 && kept.cupboard === 0 && kept.walls === 0, `open floor only in a room with ${FILLER_TUNE.minArea} square metres of it (never the 4 m² cupboard), clear of the walls by ${FILLER_TUNE.clearance} m: ${kept.floor} places on the floor over 200 buildings, ${kept.cupboard} in the cupboard`);
  ok(kept.nearFurniture === 0 && kept.nearPlace === 0, `... and every one ${FILLER_TUNE.spacing} m from every furnishing and every other place`);
  const loose = census({ ...FILLER_TUNE, minArea: 0 }, []);
  ok(loose.cupboard > 0 && loose.nearFurniture > 0, `with no least floor and nothing to keep clear of, the same draws put ${loose.cupboard} in the cupboard and ${loose.nearFurniture} beside a furnishing: the two rules are what keep them out`);
  const crowded = planSpots([], rooms, [], 200, 5);
  ok(crowded.length > 5 && crowded.length < 200, `a building with no more room gives what it has: ${crowded.length} places on 100 m² of hall, not 200`);
  ok(planSpots(seats, [], avoid, 0, 1).length === 0, 'a building of nobody has no places');
}

// ---- 5: a place's life ---------------------------------------------------------------------------------
{
  const slot: FillSlot = { state: 'empty', life: 0, nextAt: 0, leaveAt: 0 };
  openSlot(slot, 1000, 42, 0);
  ok(slot.state === 'staying' && slot.leaveAt >= 1000 && slot.leaveAt <= 1000 + FILLER_TUNE.stay[1], 'met for the first time, a place has somebody in it, some of the way through a stay');
  const leaveAt = slot.leaveAt;
  ok(stepSlot(slot, leaveAt - 0.1, false, false, 42, 0) === 'staying' && stepSlot(slot, leaveAt, false, false, 42, 0) === 'leaving', '... who gets up and leaves when the stay is out');
  ok(stepSlot(slot, leaveAt + 5, false, false, 42, 0) === 'leaving', 'walking out, it is still theirs');
  ok(stepSlot(slot, leaveAt + 20, false, true, 42, 0) === 'empty' && slot.life === 1 && slot.nextAt >= leaveAt + 20 + FILLER_TUNE.gap[0] && slot.nextAt <= leaveAt + 20 + FILLER_TUNE.gap[1], `once out of the building the place is empty for ${FILLER_TUNE.gap.join(' to ')} s, and it is the place's next life`);
  const next = slot.nextAt;
  ok(stepSlot(slot, next - 0.1, false, false, 42, 0) === 'empty' && stepSlot(slot, next, false, false, 42, 0) === 'entering', 'then somebody new comes in');
  ok(stepSlot(slot, next + 30, false, false, 42, 0) === 'entering', '... walking in until they get there');
  ok(stepSlot(slot, next + 40, true, false, 42, 0) === 'staying' && slot.leaveAt >= next + 40 + FILLER_TUNE.stay[0] && slot.leaveAt <= next + 40 + FILLER_TUNE.stay[1], `and stays ${FILLER_TUNE.stay.join(' to ')} s from the moment they arrive (the design's numbers)`);
  const lost: FillSlot = { state: 'entering', life: 3, nextAt: 0, leaveAt: 0 };
  leaveSlot(lost, 500, 42, 1);
  ok(lost.state === 'empty' && lost.life === 4 && lost.nextAt > 500, 'one who could not get in, or was taken away, leaves the place to the next life');
  const a: FillSlot = { state: 'empty', life: 0, nextAt: 0, leaveAt: 0 };
  const b: FillSlot = { state: 'empty', life: 0, nextAt: 0, leaveAt: 0 };
  openSlot(a, 0, 7, 3);
  openSlot(b, 0, 7, 3);
  ok(a.leaveAt === b.leaveAt, "a place's stays are drawn from its building's seed and its own life: the same in every browser");
}

console.log(`\n${checks} checks passed`);
