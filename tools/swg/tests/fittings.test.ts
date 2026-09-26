// The fittings: what the server stood on a world's buildings that travel has no use for, and the
// two things about them that are worth pinning -- that they never overlap travel, and that a thing
// written for a room really comes out in that room rather than a few metres from the world's origin.
//
// Run: node tools/swg/tests/fittings.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fittingCounts, fittingModels, modelIdOf, readFittingBuildings, readServerProps } from '../fittings.mjs';
import { kindOfChild, placeChildren } from '../travel.mjs';
import { childInWorld } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

// ---------------------------------------------------------------- what a fitting is

{
  // The whole of the division between the two commands: travel keeps three kinds and the fittings
  // keep everything else, so neither can ever stand a thing the other has already stood.
  const fitting = (t: string): boolean => !kindOfChild(t);
  ok(fitting('object/tangible/terminal/terminal_elevator_up.iff'), 'an elevator panel is a fitting');
  ok(fitting('object/tangible/terminal/terminal_bank.iff'), 'and so is a bank terminal');
  ok(fitting('object/tangible/sign/municipal/municipal_sign_hanging_cantina.iff'), "and the sign over a cantina's door");
  ok(!fitting('object/tangible/terminal/terminal_travel.iff'), 'a travel terminal is not: it is the travel command\'s');
  ok(!fitting('object/tangible/travel/ticket_collector/ticket_collector.iff'), 'nor is the ticket collector');
  ok(!fitting('object/creature/npc/theme_park/player_shuttle.iff'), 'nor the shuttle itself');
}

{
  // A model is keyed on the appearance rather than on the template, which is what makes two
  // templates that look identical one model and one conversion.
  ok(modelIdOf('appearance/thm_all_elevator_panel_up_s02.apt') === 'thm_all_elevator_panel_up_s02', "a model's id is its appearance's own base name");
  ok(modelIdOf('appearance\\ksk_all_bank.apt') === 'ksk_all_bank', 'written with the other slash too, which is how some of them are');
  ok(modelIdOf('') === null && modelIdOf(null) === null, 'and a template with no appearance names no model');
  // A particle effect has no mesh to convert and the pack's own effects path is what draws one.
  ok(modelIdOf('appearance/pt_magic_sparks.prt') === null, 'a particle effect names no model, rather than being handed to the mesh converter');
  const { models, missing } = fittingModels(['a/b/x.iff', 'a/b/y.iff', 'a/b/z.iff'], (shared) => (shared === 'a/b/shared_z.iff' ? null : 'appearance/one.apt'));
  ok(models.get('a/b/x.iff')?.id === 'one' && models.get('a/b/y.iff')?.id === 'one', 'two templates on one appearance are one model');
  ok(missing.length === 1 && missing[0] === 'a/b/z.iff', 'and a template the client has nothing for is named rather than dropped in silence');
}

// ---------------------------------------------------------------- the frame

{
  // The trap this whole arrangement has already paid for once, in the travel terminals: a child
  // written for a room is in its **building's** frame, and left there it stands a few metres from
  // the world's origin, which is kilometres from wherever the player is. The witness is that the
  // same local place put through the indoor path and the outdoor path must come out at the same
  // point in the world -- which it only does if the offset is composed in the snapshot's frame and
  // mirrored afterwards, not mirrored and then turned.
  const local = { x: -2.74, y: 0.64, z: 48.17, yaw: 0.3 };
  const centre = { x: 1000, z: -2000 };
  for (const byaw of [0, 0.7, -1.9, Math.PI / 2, 2.8]) {
    const building = { template: 'object/building/a.iff', x: 1200, y: 12, z: -1800, q: [Math.cos(byaw / 2), 0, Math.sin(byaw / 2), 0] };
    const inside = placeChildren([building], new Map([[building.template, [{ template: 't', model: 'm', ...local, cell: 4 }]]]))[0];
    const outside = placeChildren([building], new Map([[building.template, [{ template: 't', model: 'm', ...local, cell: -1 }]]]))[0];
    const a = childInWorld(inside, centre);
    const b = childInWorld(outside, centre);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-3, `at ${byaw.toFixed(2)} rad the two paths put one local place in one world place`);
    assert.ok(Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw))) < 1e-3, `and facing the same way at ${byaw.toFixed(2)} rad`);
  }
  passed += 2;
  console.log('ok   an indoor fitting and an outdoor one at the same local place land in the same world place, at every turn of the building');
  console.log('ok   and face the same way, which is what says the mirror is applied after the turn and not before');
}

// ---------------------------------------------------------------- the real scripts and the real worlds

{
  const core3 = process.env.CORE3 ?? 'A:/SWG Stuff/Core3/MMOCoreORB/bin/scripts';
  if (!existsSync(join(core3, 'object', 'building'))) {
    note('no emulator checkout, so the real buildings are not read (CORE3=<dir>)');
  } else {
    const byTemplate = readFittingBuildings(core3);
    ok(byTemplate.size >= 2 && byTemplate.size % 2 === 0, `${byTemplate.size / 2} building templates carry fittings, each under both its names`);
    let travelKid = 0;
    for (const kids of byTemplate.values()) for (const k of kids as { template: string }[]) if (kindOfChild(k.template)) travelKid++;
    ok(travelKid === 0, 'and not one of their children is a travel thing, so the two commands cannot stand two things in one place');

    // The second source, and the two things about its numbers that a reading of the code will not
    // catch: the height is the middle of the three, and the cell is an object id rather than a room.
    const props = readServerProps(core3, 'tatooine');
    ok(props.length > 0, `${props.length} static objects the screenplays stand on one world`);
    const inCell = props.filter((p: { cellId: number }) => p.cellId > 0);
    ok(inCell.length > 0, `${inCell.length} of them inside a building`);
    // Every one of those cell ids is a real client object id, which is a big number: a room index
    // would be under a hundred, and reading it as one would put every indoor prop in room 4.
    ok(inCell.every((p: { cellId: number }) => p.cellId > 1000), 'and every cell it names is an object id, not a room number');
    // The outdoor ones stand on a world whose ground is a few hundred metres at most: read with the
    // depth as the height, they would be kilometres up or down.
    const outdoor = props.filter((p: { cellId: number }) => !p.cellId);
    ok(outdoor.length > 0 && outdoor.every((p: { y: number }) => Math.abs(p.y) < 600), 'and the height of an outdoor one is the middle of its three numbers, not the last');
    ok(props.every((p: { yaw: number }) => Number.isFinite(p.yaw) && Math.abs(p.yaw) <= Math.PI + 1e-6), 'every turn reads as a turn');
  }
}

{
  let worlds = 0;
  let things = 0;
  let indoors = 0;
  for (const planet of ['corellia', 'naboo', 'tatooine', 'talus', 'rori', 'lok', 'dantooine', 'endor', 'yavin4', 'dathomir']) {
    const file = join('assets-private', planet, 'fittings.json');
    if (!existsSync(file)) continue;
    const pack = JSON.parse(readFileSync(file, 'utf8')) as { version: number; rows: { model: string; cell: number; x: number; y: number; z: number }[] };
    assert.ok(pack.version === 1, `${planet}: the pack is the shape this build reads`);
    const manifest = JSON.parse(readFileSync(join('assets-private', planet, 'manifest.json'), 'utf8')) as { categories?: { layout?: { id: string }[] } };
    const have = new Set((manifest.categories?.layout ?? []).map((d) => d.id));
    for (const r of pack.rows) {
      assert.ok(!!r.model, `${planet}: every fitting says what it is drawn with`);
      assert.ok(have.has(r.model), `${planet}: and that model is really in the pack (${r.model})`);
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z), `${planet}: and stands somewhere real`);
    }
    const counts = fittingCounts(pack.rows);
    assert.ok(counts.models > 0, `${planet}: it draws something`);
    worlds++;
    things += pack.rows.length;
    indoors += counts.indoors;
  }
  if (!worlds) note("no world carries fittings.json yet (npm run swg -- fittings '@SWG' assets-private --retail-only)");
  else {
    passed += 2;
    console.log(`ok   ${things} fittings over ${worlds} converted worlds, ${indoors} of them in a room, every one with a model the pack really holds`);
    console.log('ok   and every one of them somewhere real');
  }
}

console.log(`\n${passed} checks passed`);
