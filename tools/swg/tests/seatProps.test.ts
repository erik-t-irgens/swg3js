// The chairs and tables of ours under the people the data sits down (src/world/seatProps.ts).
//
// The planning is pure, so it is driven here on rows written by hand: a chair under every sitter at its
// place and facing its way, a table in front of every one sat at a table, sitters round one table sharing
// it, nothing over a seat or a table the data already has, nothing for somebody sat on the ground, and the
// same plan from the same rows in any order. The rows come out of `StandingPeople.seatedRows`, which is
// driven here too, frame and all. Where the real packs are converted the whole of each world is planned
// over its own snapshot, which is the only way to know what the rule really stands.
//
// Run: node tools/swg/tests/seatProps.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEAT_TUNE, isTableTemplate, pickBy, planSeats, seatOfMood, seatTally, tuneSeats, type SeatKind, type SeatWorld, type SeatedRow } from '../../../src/world/seatProps.ts';
import { isSeat } from '../../../src/world/ambient/fillers.ts';
import { StandingPeople, type StandingRow } from '../../../src/world/standingPeople.ts';
import { intoWorld } from '../../../src/world/wildLife.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A world with nothing of its own placed, flat at a height. */
const empty = (ground = 0): SeatWorld => ({ has: () => false, ground: () => ground });
const row = (key: string, x: number, z: number, heading: number, sits: SeatKind, o: Partial<SeatedRow> = {}): SeatedRow => ({ key, x, y: 4, z, heading, inside: true, sits, ...o });

// --- 1: what a mood sits on ---------------------------------------------------------------------
{
  ok(seatOfMood('npc_sitting_chair') === 'chair', '1: the chair mood sits on a chair');
  ok(seatOfMood('npc_sitting_table') === 'table' && seatOfMood('npc_sitting_table_eating') === 'table', '1: the table moods sit at a table, eating or not');
  ok(seatOfMood('npc_sitting_ground') === null && seatOfMood('sad') === null && seatOfMood(null) === null && seatOfMood('') === null, '1: and the ground, a standing mood and none sit on nothing of ours');
  ok(isTableTemplate('object/tangible/furniture/tatooine/shared_frn_tatt_table_cantina_table_1.iff') && isTableTemplate('object/static/worldbuilding/furniture/shared_cantina_table_2.iff'), "1: the data's cantina tables are tables");
  ok(!isTableTemplate('object/tangible/furniture/tatooine/shared_frn_tatt_lamp_tbl_s1.iff') && !isTableTemplate('object/tangible/furniture/tatooine/shared_frn_tatt_chair_cantina_seat.iff'), '1: and a lamp on one, or a chair, is not');
  ok(isSeat('object/tangible/furniture/tatooine/shared_frn_tatt_chair_cantina_seat.iff'), "1: the data's cantina chairs are seats, by the fillers' own rule");
}

// --- 2: a chair under every sitter ----------------------------------------------------------------
{
  const plan = planSeats([row('a', 10, 20, 1.2, 'chair')], empty());
  ok(plan.props.length === 1 && plan.props[0].kind === 'chair', '2: one sitter in a chair is one chair');
  const c = plan.props[0];
  ok(c.x === 10 && c.z === 20 && c.y === 4 && near(c.yaw, 1.2) && c.inside, '2: at its own place, on its own floor, facing its own way');
  ok(SEAT_TUNE.chairs.includes(c.model), `2: drawn with one of the cantina's chairs (${c.model})`);
  ok(planSeats([row('a', 10, 20, 1.2, 'chair')], empty()).props[0].model === c.model, '2: and the same one every time for the same row');
  const out = planSeats([row('a', 10, 20, 1.2, 'chair', { inside: false, y: 99 })], empty(7));
  ok(out.props[0].y === 7 && !out.props[0].inside, '2: out in the open it stands on the ground under the sitter, not at the height the row was written at');
  const off = { ...SEAT_TUNE, outdoors: false };
  ok(planSeats([row('a', 10, 20, 1.2, 'chair', { inside: false })], empty(), off).props.length === 0, '2: and none out in the open with the switch off');
  ok(planSeats([row('a', 10, 20, 1.2, 'chair')], empty(), { ...SEAT_TUNE, on: false }).props.length === 0, '2: nor anywhere with the whole of it off');
  ok(planSeats([row('a', Number.NaN, 20, 1.2, 'chair'), row('b', 1, 2, Number.NaN, 'chair')], empty()).props.length === 0, '2: a row whose place or facing is not a number stands nothing');
}

// --- 3: tables, and who shares one -------------------------------------------------------------
{
  // One at a table: a chair under it and a table in front of it, `ahead` along its facing.
  const one = planSeats([row('a', 0, 0, 0, 'table')], empty());
  const t = one.props.find((p) => p.kind === 'table')!;
  ok(one.props.filter((p) => p.kind === 'chair').length === 1 && !!t, '3: one sat at a table has a chair under it and a table');
  ok(near(t.x, 0) && near(t.z, SEAT_TUNE.ahead) && t.y === 4, `3: the table stands ${SEAT_TUNE.ahead} m in front of it, on its floor`);
  ok(SEAT_TUNE.tables.includes(t.model) && t.key === 'table:a', '3: drawn with one of the cantina tables and named for its first sitter');

  // Two facing each other across one table, as the Mos Eisley cantina's own eating pair do.
  const pair = planSeats([row('a', 0, 0, 0, 'table'), row('b', 0, 1.7, Math.PI, 'table')], empty());
  const tables = pair.props.filter((p) => p.kind === 'table');
  ok(tables.length === 1 && pair.shared === 1, '3: two facing each other share one table');
  ok(near(tables[0].x, 0) && near(tables[0].z, 0.85, 1e-6), '3: which stands between them, where both face');

  // One at a table and three round it in chairs: the table drawn to where all four face.
  const round = [row('dev', 0, 1, Math.PI, 'table'), row('ish', 0.9, -0.6, -Math.PI / 4, 'chair'), row('nik', 2, 0.5, -Math.PI / 2, 'chair')];
  const group = planSeats([...round, row('far', 9, 9, 0, 'chair')], empty());
  const gt = group.props.filter((p) => p.kind === 'table');
  ok(gt.length === 1 && group.props.filter((p) => p.kind === 'chair').length === 4, '3: one at a table and three round it in chairs is four chairs and one table');
  // Where each faces, `ahead` along its heading: the table stands at the mean of the three spots that join.
  const facing = (x: number, z: number, h: number) => ({ x: x + Math.sin(h) * SEAT_TUNE.ahead, z: z + Math.cos(h) * SEAT_TUNE.ahead });
  const spots = [facing(0, 1, Math.PI), facing(0.9, -0.6, -Math.PI / 4), facing(2, 0.5, -Math.PI / 2)];
  const mean = { x: spots.reduce((s, p) => s + p.x, 0) / 3, z: spots.reduce((s, p) => s + p.z, 0) / 3 };
  ok(near(gt[0].x, mean.x) && near(gt[0].z, mean.z), `3: the table stands at the mean of where the three round it face (${gt[0].x.toFixed(3)}, ${gt[0].z.toFixed(3)}), not in front of the one at it alone`);
  const without = planSeats(round, empty()).props.find((p) => p.kind === 'table')!;
  ok(without.x === gt[0].x && without.z === gt[0].z, '3: and one sat in a chair across the room draws nothing: the table is exactly where it is without them');

  // Only the guards decide these: each chair sitter below would join the table if it were not for one rule.
  const table = (rows: SeatedRow[], world = empty()) => planSeats(rows, world).props.find((p) => p.kind === 'table')!;
  const lone = table([row('a', 0, 0, 0, 'table')]);
  ok(near(lone.x, 0) && near(lone.z, SEAT_TUNE.ahead), '3: the lone table is the reference the rest are held to');
  // Facing spots 1.6 m and 1.4 m off the table's spot, along x: the first past `share` and the second inside it.
  const past = table([row('a', 0, 0, 0, 'table'), row('b', 1.6, 0, 0, 'chair')]);
  ok(past.x === lone.x && past.z === lone.z, `3: a chair sitter facing a spot ${(1.6).toFixed(1)} m from the table's, past the ${SEAT_TUNE.share} m it shares within, does not move it`);
  const inside = table([row('a', 0, 0, 0, 'table'), row('b', 1.4, 0, 0, 'chair')]);
  ok(near(inside.x, 0.7) && near(inside.z, SEAT_TUNE.ahead), '3: while one facing a spot 1.4 m from it does, to halfway between the two spots');
  const balcony = table([row('a', 0, 0, 0, 'table'), row('b', 0.5, 0, 0, 'chair', { y: 4 + SEAT_TUNE.level + 1.8 })]);
  ok(balcony.x === lone.x && balcony.z === lone.z, '3: one on the balcony above, facing a spot right beside it, does not move it: another floor');
  const outside = table([row('a', 0, 0, 0, 'table'), row('b', 0.5, 0, 0, 'chair', { inside: false })], empty(4));
  ok(outside.x === lone.x && outside.z === lone.z, '3: nor does one out in the open beside an indoor table, on the very same height');
  const away = table([row('a', 0, 0, 0, 'table'), row('b', 0, SEAT_TUNE.ahead + 1.2, 0, 'chair')]);
  ok(away.x === lone.x && away.z === lone.z, '3: nor one sat 1.2 m from it facing away, since what it would join is where it faces, not where it sits');
  // And two at tables beside each other, one indoors and one out, are two tables however near.
  const split = planSeats([row('a', 0, 0, 0, 'table'), row('b', 0.3, 0, 0, 'table', { inside: false })], empty(4));
  ok(split.props.filter((p) => p.kind === 'table').length === 2, '3: two at tables side by side, one indoors and one out in the open, are two tables');
  const outTable = table([row('a', 0, 0, 0, 'table', { inside: false, y: 99 })], empty(7));
  ok(outTable.y === 7 && !outTable.inside, '3: and a table out in the open stands on the ground, as its chair does, not at the height the row was written at');

  // Two tables far apart are two tables; two on different floors are two.
  const two = planSeats([row('a', 0, 0, 0, 'table'), row('b', 10, 0, 0, 'table')], empty());
  ok(two.props.filter((p) => p.kind === 'table').length === 2 && two.shared === 0, '3: two at tables ten metres apart are two tables');
  const floors = planSeats([row('a', 0, 0, 0, 'table'), row('b', 0, 0.2, 0, 'table', { y: 9 })], empty());
  ok(floors.props.filter((p) => p.kind === 'table').length === 2, '3: and two over one another on different floors are two');
  ok(planSeats([row('a', 0, 0, 0, 'table')], empty(), { ...SEAT_TUNE, tables: [] }).props.every((p) => p.kind === 'chair'), '3: with no table model, only chairs');
}

// --- 4: never over what the data already has --------------------------------------------------------
{
  const asked: string[] = [];
  const hasChairAtOrigin: SeatWorld = {
    has: (kind, x, _y, z, reach) => {
      asked.push(kind);
      return kind === 'chair' && Math.hypot(x, z) <= reach;
    },
    ground: () => 0,
  };
  const plan = planSeats([row('a', 0, 0, 0, 'chair'), row('b', 5, 5, 0, 'chair')], hasChairAtOrigin);
  ok(plan.props.length === 1 && plan.props[0].key === 'b' && plan.had.chairs === 1, '4: a sitter already on a seat of the data\'s gets none of ours; the one beside it does');
  ok(asked.every((k) => k === 'chair'), '4: and only chairs were asked about for two sitters in chairs');
  const hasTable: SeatWorld = { has: (kind) => kind === 'table', ground: () => 0 };
  const t = planSeats([row('a', 0, 0, 0, 'table')], hasTable);
  ok(t.props.length === 1 && t.props[0].kind === 'chair' && t.had.tables === 1, '4: a table the data already has stands for ours');
  let reachAsked = 0;
  planSeats([row('a', 0, 0, 0, 'table')], {
    has: (kind, _x, _y, _z, reach, level) => {
      if (kind === 'table') reachAsked = reach;
      if (kind === 'chair') assert.ok(reach === SEAT_TUNE.seatNear && level === SEAT_TUNE.level);
      return false;
    },
    ground: () => 0,
  });
  ok(reachAsked === SEAT_TUNE.tableNear, `4: a chair is asked after within ${SEAT_TUNE.seatNear} m and a table within ${SEAT_TUNE.tableNear} m, on the same floor`);
}

// --- 5: the same rows make the same plan --------------------------------------------------------------
{
  const rows = [row('c', 0, 0, 0, 'table'), row('a', 0, 1.7, Math.PI, 'table'), row('b', 4, 4, 1, 'chair'), row('d', 0.8, 0.8, -2.4, 'chair')];
  const one = JSON.stringify(planSeats(rows, empty()));
  const other = JSON.stringify(planSeats([...rows].reverse(), empty()));
  ok(one === other, '5: the same rows in another order make the same plan, models and all');
  ok(pickBy(['x', 'y', 'z'], 'key') === pickBy(['x', 'y', 'z'], 'key'), '5: and a pick by a key is the same pick every time');
  const tally = seatTally(planSeats(rows, empty()).props);
  ok(tally.chairs === 4 && tally.tables === 1 && tally.indoors === 5 && Object.values(tally.byModel).reduce((a, b) => a + b, 0) === 5, '5: the tally counts what the plan holds');
}

// --- 6: the knob -------------------------------------------------------------------------------------
{
  const tune = { ...SEAT_TUNE, chairs: [...SEAT_TUNE.chairs], tables: [...SEAT_TUNE.tables] };
  const moved = tuneSeats({ ahead: 1, outdoors: false, chairs: ['thm_frn_chair_s02'], share: 'far', tables: [], nothing: 3 }, tune);
  ok(moved.join(' ') === 'ahead outdoors chairs' && tune.ahead === 1 && !tune.outdoors && tune.chairs[0] === 'thm_frn_chair_s02', '6: a number, a switch and a list of names are moved by their own kind');
  ok(tune.share === SEAT_TUNE.share && tune.tables.length === SEAT_TUNE.tables.length, '6: and a word for a number, or an empty list of models, moves nothing');
}

// --- 7: the rows out of the standing people, in the world's frame ---------------------------------------
{
  const centre = { x: 100, z: 50 };
  const rows: StandingRow[] = [
    { who: 'patron', id: 'p', key: 'k1', x: 120, y: 4, z: 60, heading: 0.5, cell: 7, room: 3, respawn: 300, where: 'cities', mood: 'npc_sitting_chair' },
    { who: 'patron', id: 'p', key: 'k2', x: 121, y: 4, z: 60, heading: -1, cell: 7, room: 3, respawn: 300, where: 'cities', mood: 'npc_sitting_table_eating' },
    { who: 'giver', id: 'g', key: 'k3', x: 90, y: 0, z: 40, heading: 0, cell: 0, respawn: 0, where: 'tasks', sit: true },
    { who: 'patron', id: 'p', key: 'k4', x: 130, y: 4, z: 60, heading: 0, cell: 7, room: 3, respawn: 300, where: 'cities', mood: 'npc_sitting_ground' },
    { who: 'guard', id: 'g', key: 'k5', x: 130, y: 0, z: 70, heading: 0, cell: 0, respawn: 300, where: 'cities', mood: 'npc_sitting_chair', gcw: [{ who: 'stormtrooper' }, { who: 'rebel' }] },
  ];
  const people = new StandingPeople();
  people.adopt(rows);
  ok(people.seatedRows(null).length === 0, '7: with no centre to carry them by, nothing');
  const seated = people.seatedRows(centre);
  ok(seated.map((r) => r.key).join(' ') === 'k1 k2 k3', '7: the chair and table moods, and a giver the server sat down, sit; the ground and a guard do not');
  const w = intoWorld(120, 60, centre);
  ok(seated[0].x === w.x && seated[0].z === w.z && seated[0].heading === -0.5 && seated[0].inside && seated[0].sits === 'chair', "7: in the world's frame, the heading mirrored with it, indoors");
  ok(seated[1].sits === 'table' && seated[2].sits === 'chair' && !seated[2].inside, '7: what each sits on, and the giver out in the open');
  ok(people.seatedRows(centre)[0].x === w.x, '7: and asked again, carried only once');
}

// --- 8: the real worlds -----------------------------------------------------------------------------------
// Each converted world planned whole over its own snapshot, mirrored into the world's frame as the
// streamer does, with the data's own seats and tables found by the same two rules the game asks.
{
  const worlds = ['tatooine', 'corellia', 'naboo', 'talus', 'rori', 'lok', 'dantooine', 'yavin4'];
  let any = false;
  const total = { chairs: 0, tables: 0, hadChairs: 0, hadTables: 0, sitters: 0 };
  for (const world of worlds) {
    const sp = join('assets-private', world, 'spawns.json');
    const lp = join('assets-private', world, 'layout.json');
    if (!existsSync(sp) || !existsSync(lp)) continue;
    any = true;
    const layout = JSON.parse(readFileSync(lp, 'utf8')) as { center: { x: number; z: number }; objects: { template: string; x: number; y: number; z: number; contained?: boolean }[] };
    const statics = (JSON.parse(readFileSync(sp, 'utf8')) as { statics: StandingRow[] }).statics;
    const people = new StandingPeople();
    people.adopt(statics);
    const rows = people.seatedRows(layout.center);
    const furniture = layout.objects
      .filter((o) => o.template.startsWith('object/') && (isSeat(o.template) || isTableTemplate(o.template)))
      .map((o) => ({ ...intoWorld(o.x, o.z, layout.center), y: o.y, contained: !!o.contained, seat: isSeat(o.template), table: isTableTemplate(o.template) }));
    const plan = planSeats(rows, {
      has: (kind, x, y, z, reach, level) => furniture.some((f) => (kind === 'chair' ? f.seat : f.table) && Math.hypot(f.x - x, f.z - z) <= reach && (!f.contained || Math.abs(f.y - y) <= level)),
      ground: () => 0,
    });
    const t = seatTally(plan.props);
    total.chairs += t.chairs;
    total.tables += t.tables;
    total.hadChairs += plan.had.chairs;
    total.hadTables += plan.had.tables;
    total.sitters += rows.length;
    note(`${world}: ${rows.length} sitting rows, ${t.chairs} chairs and ${t.tables} tables of ours (${plan.shared} shared), the data already had ${plan.had.chairs} seats and ${plan.had.tables} tables under them`);
    ok(t.chairs + plan.had.chairs === rows.length, `8: on ${world} every sitter has a chair, the data's or ours`);
    ok(plan.props.every((p) => SEAT_TUNE.chairs.includes(p.model) || SEAT_TUNE.tables.includes(p.model)), `8: and every one of ours is a cantina chair or table`);
  }
  if (!any) note('no converted spawns and layouts here: the planning is checked on rows written by hand only');
  else {
    note(`all worlds: ${total.sitters} sitting rows, ${total.chairs} chairs and ${total.tables} tables of ours, ${total.hadChairs} seats and ${total.hadTables} tables the data already had`);
    ok(total.chairs > 0, '8: somewhere the data sits somebody on nothing, and now there is a chair');
  }
  const props = join('assets-private', 'props', 'manifest.json');
  if (existsSync(props)) {
    const models = new Set((JSON.parse(readFileSync(props, 'utf8')) as { models: { id: string }[] }).models.map((m) => m.id));
    const missing = [...SEAT_TUNE.chairs, ...SEAT_TUNE.tables].filter((m) => !models.has(m));
    ok(missing.length === 0, `8: the props pack carries every model the seats are drawn with${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
  } else note('no props pack converted here: the models it would carry are not checked');
}

console.log(`\n${checks} checks passed`);
