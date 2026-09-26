// The travel terminals, the ticket collectors and the shuttles: the two surprises in the numbers,
// and the join to the worlds that really place them.
//
// Run: node tools/swg/tests/travel.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { childYaw, kindOfChild, modelOfKind, moodOfRow, placeChildren, readTravelBuildings, rigClipTable, rigOfRow, rowsLost, TRAVEL_MODELS, TRAVEL_OWN_MODELS, travelCounts, yawOfQuat } from '../travel.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

// ---------------------------------------------------------------- what a child is

{
  ok(kindOfChild('object/tangible/terminal/terminal_travel.iff') === 'terminal', 'a travel terminal is a terminal');
  ok(kindOfChild('object/tangible/terminal/terminal_travel_tutorial.iff') === 'terminal', 'and so is the tutorial one');
  ok(kindOfChild('object/tangible/travel/ticket_collector/ticket_collector.iff') === 'collector', 'a ticket collector is where a ticket is taken');
  ok(kindOfChild('object/mobile/player_transport.iff') === 'shuttle', 'and the transport is the shuttle itself');
  // The shuttle has two names and only one of them was known, so every shuttleport in the game came
  // out with a terminal, a collector and no shuttle: a starport declares a transport and a
  // shuttleport declares a shuttle.
  ok(kindOfChild('object/creature/npc/theme_park/player_shuttle.iff') === 'shuttle', "a shuttleport's own shuttle is a shuttle too, which is the name that was being dropped");
  ok(kindOfChild('object/tangible/terminal/terminal_bank.iff') === null, 'a bank terminal is not a travel terminal, although both are terminals');
  ok(kindOfChild(undefined) === null, 'and nothing at all is nothing');
}

{
  // Which model draws each thing is written into the pack rather than worked out in the game, so
  // nothing downstream ever guesses at a name and a pack made before a model existed carries null.
  ok(modelOfKind('terminal', 'object/tangible/terminal/terminal_travel.iff') === 'ksk_all_travel', 'a terminal names the model the terminal is drawn with');
  ok(modelOfKind('collector', 'x/ticket_collector.iff') === '3po_protocol_droid_silver', 'the collector is a droid, and names a catalogue entry rather than a model file');
  ok(modelOfKind('shuttle', 'object/creature/npc/theme_park/player_shuttle.iff') === 'shuttle', "a shuttleport's shuttle has a model of its own");
  // The starport's transport is deliberately left undrawn: its own mesh is a placeholder and the
  // hull it shows is five separate pieces hung off its client data, which nothing here assembles.
  ok(modelOfKind('shuttle', 'object/mobile/player_transport.iff') === null, 'and the starport transport has none, which is said rather than guessed at');
}

// ---------------------------------------------------------------- the frame

{
  // The first surprise: a child is written `x, z, y` with **z the height**, which is the emulator's
  // own convention and not the game's. Corellia's own starport terminal is the witness: it stands
  // 48 m along the building and 0.64 m off its floor, and read the other way round it would be
  // forty-eight metres in the air.
  const buildings = new Map([['object/building/a.iff', [{ kind: 'terminal', x: -2.74, y: 0.64, z: 48.17, yaw: 0, cell: 4 }]]]);
  const rows = placeChildren([{ template: 'object/building/a.iff', x: 100, y: 5, z: 200, q: [1, 0, 0, 0] }], buildings);
  ok(rows.length === 1 && rows[0].cell === 4, 'a child inside a building keeps the cell it was written for');
  ok(rows[0].y === 0.64 && rows[0].z === 48.17, "and its place is left in the building's own frame, which is the frame the game will walk it in");
  ok(rows[0].bx === 100 && rows[0].bz === 200, 'with the building it stands in written beside it');
}

{
  const buildings = new Map([['object/building/a.iff', [{ kind: 'collector', x: 10, y: 0, z: -10, yaw: 0, cell: -1 }]]]);
  const straight = placeChildren([{ template: 'object/building/a.iff', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }], buildings);
  ok(straight[0].cell === 0 && straight[0].x === 10 && straight[0].z === -10, 'a child outside a building is put into the world, since nothing else will');
  // A quarter turn about the up axis: [w, x, y, z] with y = sin(45deg).
  const turned = placeChildren([{ template: 'object/building/a.iff', x: 0, y: 0, z: 0, q: [Math.SQRT1_2, 0, Math.SQRT1_2, 0] }], buildings);
  ok(Math.abs(turned[0].x + 10) < 1e-3 && Math.abs(turned[0].z + 10) < 1e-3, 'and turns with the building it belongs to');
  ok(Math.abs(turned[0].byaw - Math.PI / 2) < 1e-3, "and is told which way that building faces");
}

{
  ok(Math.abs(yawOfQuat([1, 0, 0, 0])) < 1e-9, 'the identity turn has no yaw');
  ok(Math.abs(yawOfQuat([Math.SQRT1_2, 0, Math.SQRT1_2, 0]) - Math.PI / 2) < 1e-9, 'and a quarter turn about the up axis is a quarter turn');
  ok(Math.abs(childYaw({ ow: 0.909306, oy: -0.416129 }) + 0.858) < 0.01, "a child's own turn is read the same way, out of its ow and oy");
  ok(childYaw({}) === 0, 'and a child with no turn at all faces along the building');
  // Theed's transport is written (0, 1, 0, 1): a quarter turn that is not unit length. Read as if it
  // were, it stood at 116.6 degrees and sat crooked in its hangar.
  ok(Math.abs(childYaw({ oy: 1, ow: 1 }) - Math.PI / 2) < 1e-9, 'a quarter turn written at any length is a quarter turn');
  ok(Math.abs(childYaw({ oy: 0.7, ow: 0.7 }) - Math.PI / 2) < 1e-9, 'including the 0.7 and 0.7 the scripts write for one');
  const ref = JSON.parse(readFileSync(new URL('../core3ref/travel-buildings.json', import.meta.url), 'utf8')) as { $map: [string, { kind: string; yaw: number }[]][] };
  const theed = ref.$map.find(([t]) => t === 'object/building/naboo/hangar_naboo_theed.iff')?.[1].find((k) => k.kind === 'shuttle');
  ok(!!theed && Math.abs(theed.yaw - Math.PI / 2) < 1e-3, `and the reference in the checkout carries Theed's transport square in its hangar (${theed ? ((theed.yaw * 180) / Math.PI).toFixed(1) : '?'} degrees)`);
}

// ---------------------------------------------------------------- which rig a shuttle lands with

{
  ok(rigOfRow({ kind: 'shuttle', model: 'shuttle' }) === 'shuttle', "a shuttleport's shuttle lands on the shuttle's rig");
  ok(rigOfRow({ kind: 'shuttle', model: null }) === 'transport', "and a starport's transport, which names no model, on the transport's");
  ok(rigOfRow({ kind: 'terminal', model: 'ksk_all_travel' }) === null, 'and nothing else has a rig at all');
  ok(moodOfRow({ building: 'object/building/naboo/shared_hangar_naboo_theed.iff' }, 'transport') === 'theed', "Theed's hangar plays Theed's branch");
  ok(moodOfRow({ building: 'object/building/corellia/shared_starport_corellia.iff' }, 'transport') === 'calm', 'every other starport the one they share');
  ok(moodOfRow({ building: 'object/building/naboo/theed_shuttleport.iff' }, 'shuttle') === '', 'and the shuttle, which has one branch, none');
  const transport = rigClipTable(['take_off:calm', 'take_off:theed', 'loop_sky:calm', 'loop_sky:theed', 'land:calm', 'land:theed', 'intro_land', 'loop_ground:calm', 'loop_ground:theed']);
  ok(Object.keys(transport).sort().join() === 'calm,theed' && transport.theed.land === 'land:theed' && transport.calm.ground === 'loop_ground:calm', "the transport's clips come out as two branches, each with its four roles");
  const shuttle = rigClipTable(['take_off', 'loop_sky', 'land', 'intro_land', 'loop_ground']);
  ok(Object.keys(shuttle).join() === '' && shuttle[''].lift === 'take_off' && shuttle[''].sky === 'loop_sky', "the shuttle's as one branch with no name");
  ok(Object.keys(rigClipTable(['loop_ground', 'take_off'])).length === 0, 'and a table with no landing is no rig');
}

{
  const buildings = new Map([['object/building/a.iff', [{ kind: 'terminal', x: 0, y: 0, z: 0, yaw: 0, cell: 1 }]]]);
  const none = placeChildren([{ template: 'object/building/b.iff', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }], buildings);
  ok(none.length === 0, 'a building the scripts say nothing about contributes nothing');
  const twice = placeChildren(
    [
      { template: 'object/building/a.iff', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] },
      { template: 'object/building/a.iff', x: 500, y: 0, z: 0, q: [1, 0, 0, 0] },
    ],
    buildings,
  );
  ok(twice.length === 2 && twice[1].bx === 500, 'and one placed twice carries its children twice, which is the whole reason this is a template and not a list of places');
}

// ---------------------------------------------------------------- the real scripts and the real worlds

{
  const core3 = process.env.CORE3 ?? 'A:/SWG Stuff/Core3/MMOCoreORB/bin/scripts';
  if (!existsSync(join(core3, 'object', 'building'))) {
    note('no emulator checkout, so the real buildings are not read (CORE3=<dir>)');
  } else {
    const byTemplate = readTravelBuildings(core3);
    // Both spellings of every building are written, the server's and the shared one a snapshot uses.
    ok(byTemplate.size >= 2 && byTemplate.size % 2 === 0, `${byTemplate.size / 2} building templates carry travel children, each under both its names`);
    const star = [...byTemplate.entries()].find(([t]) => /shared_starport_corellia/.test(t));
    ok(!!star, "Corellia's starport is one of them");
    if (star) {
      const kinds = star[1].map((k: { kind: string }) => k.kind);
      ok(kinds.filter((k) => k === 'terminal').length === 4, 'with four travel terminals, as the game had it');
      ok(kinds.includes('collector') && kinds.includes('shuttle'), 'a ticket collector to board at, and the shuttle itself');
      const terminals = star[1].filter((k: { kind: string }) => k.kind === 'terminal');
      ok(
        terminals.every((k: { y: number }) => Math.abs(k.y) < 3),
        `every one of them stands within a few metres of a floor (${terminals.map((k: { y: number }) => k.y.toFixed(2)).join(', ')}), which is what says the height was read off the right axis`,
      );
      ok(
        terminals.some((k: { z: number }) => Math.abs(k.z) > 20),
        'and well down the building, which is where the other axis went',
      );
    }

    let worlds = 0;
    let things = 0;
    let indoors = 0;
    let drawn = 0;
    for (const planet of ['corellia', 'naboo', 'tatooine', 'talus', 'rori', 'lok', 'dantooine', 'endor', 'yavin4', 'dathomir']) {
      const file = join('assets-private', planet, 'travel.json');
      if (!existsSync(file)) continue;
      const pack = JSON.parse(readFileSync(file, 'utf8')) as { version: number; rigs?: Record<string, { file: string; parts: { file: string }[] }>; rows: { kind: string; model?: string | null; rig?: string; cell: number; x: number; y: number; z: number }[] };
      assert.ok(pack.version === 3, `${planet}: the pack is the shape this build writes (run travel again if not)`);
      // Every shuttle lands on a rig the file carries, and every file the rig names is on disk: the
      // rigs are one folder every world shares, so a world can be current while its pieces have gone.
      for (const r of pack.rows) if (r.kind === 'shuttle') assert.ok(!!r.rig && !!pack.rigs?.[r.rig], `${planet}: a shuttle names a rig the file carries`);
      for (const rig of Object.values(pack.rigs ?? {})) for (const f of [rig.file, ...rig.parts.map((p) => p.file)]) assert.ok(existsSync(join('assets-private', f)), `${planet}: ${f} is on disk`);
      const counts = travelCounts(pack.rows);
      assert.ok(counts.terminals > 0, `${planet}: it has somewhere to buy a ticket`);
      assert.ok(counts.collectors > 0, `${planet}: and somewhere to board`);
      for (const r of pack.rows) assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z), `${planet}: every one of them is somewhere real`);
      // Every terminal and every collector must name a model, or they are things to press and not
      // to see -- which is the state the first cut of this left every world in.
      for (const r of pack.rows) if (r.kind !== 'shuttle') assert.ok(!!r.model, `${planet}: a ${r.kind} says what it is drawn with`);
      drawn += pack.rows.filter((r) => r.model).length;
      worlds++;
      things += pack.rows.length;
      indoors += counts.indoors;
    }
    if (!worlds) note("no world carries travel.json yet (npm run swg -- travel '@SWG' assets-private --retail-only)");
    else {
      passed++;
      console.log(`ok   ${things} travel things over ${worlds} converted worlds, every one of them somewhere real`);
      passed++;
      console.log(`ok   and ${drawn} of them are drawn, which is every terminal and collector plus a shuttleport's own shuttle`);
      note(`${indoors} of them stand inside a building, which is where a terminal belongs and why the cell travels with it`);
      note(`${things - drawn} are the starports' own transports, which have no single model: their mesh is a placeholder and the hull is five pieces hung on the transport rig's joints`);
      passed++;
      console.log('ok   and every shuttle lands on a rig whose files are on disk');
    }
  }
}

// ---- Whether a world's rows were lost, and the false alarm it caused -----------------------------
//
// `status` tells a world that was snapshotted again since these rows were written by looking for a row
// whose model the pack's layout category no longer carries -- a snapshot rewrites that category
// outright and silently takes the terminals out of it. The trap is that **not every row's model is in
// the layout in the first place**: the ticket collector is drawn with the mobiles pack's own protocol
// droid, deliberately, and is never in a world's layout at all. Judged without that, every world on
// the owner's machine looked as if its rows had been lost, and `status` asked for `travel` again
// however many times it had just been run. This project has published a false accusation from a status
// line once before; the rule is pinned here so it cannot happen a third time.
{
  const layout = new Set(['ksk_all_travel', 'shuttle']);
  const rows = [
    { kind: 'terminal', model: 'ksk_all_travel' },
    { kind: 'collector', model: '3po_protocol_droid_silver' },
    { kind: 'shuttle', model: 'shuttle' },
    { kind: 'shuttle', model: null },
  ];
  assert.equal(rowsLost(rows, layout, TRAVEL_OWN_MODELS), false, 'a full world is not lost');
  passed++;
  console.log('ok   a world with every one of its own models is not called lost');
  assert.equal(rowsLost(rows, new Set(['shuttle']), TRAVEL_OWN_MODELS), true, 'a missing terminal is lost');
  passed++;
  console.log('ok   and one whose terminal model has gone is');
  // The collector is the whole point: it is in no layout anywhere, and must never be counted.
  assert.equal(TRAVEL_OWN_MODELS.has('3po_protocol_droid_silver'), false, 'the collector is not one of ours');
  assert.equal(rowsLost([{ kind: 'collector', model: '3po_protocol_droid_silver' }], new Set(), TRAVEL_OWN_MODELS), false, 'a collector alone is never lost');
  passed++;
  console.log("ok   the collector is drawn from the mobiles pack and is never counted as lost (the false alarm)");
  // Without the set, which is how the fittings are judged, every model is this command's own.
  assert.equal(rowsLost([{ kind: 'x', model: 'anything' }], new Set()), true, 'with no set, any missing model is lost');
  passed++;
  console.log('ok   with no set of its own -- how the fittings are judged -- any missing model counts');
  // And the set is read off the list of models the command really converts, so adding one extends the
  // check by itself rather than needing this rule edited too.
  assert.deepEqual([...TRAVEL_OWN_MODELS].sort(), TRAVEL_MODELS.map(([id]) => id).sort(), 'the set is the models the command writes');
  passed++;
  console.log('ok   and the set is exactly the models the command converts, so a new one is covered by itself');
  // A row with no model at all is a starport's own transport, which has no single mesh: never lost.
  assert.equal(rowsLost([{ kind: 'shuttle', model: null }], new Set(), TRAVEL_OWN_MODELS), false, 'a row with no model is not lost');
  passed++;
  console.log("ok   and a row with no model -- a starport's own transport -- is not lost either");
}

console.log(`\n${passed} checks passed`);
