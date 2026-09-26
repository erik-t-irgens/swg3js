// The travel terminals, the ticket collectors and the shuttles: the two surprises in the numbers,
// and the join to the worlds that really place them.
//
// Run: node tools/swg/tests/travel.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { childYaw, correctShuttleTurn, kindOfChild, modelOfKind, moodOfRow, placeChildren, readShuttleEffect, readTravelBuildings, RIG_FX_ROLES, rigClipTable, rigMarks, rigOfRow, rowsLost, SHUTTLE_TURN, shuttleTurnFix, splitHpEvent, TRAVEL_MODELS, TRAVEL_OWN_MODELS, travelCounts, yawOfQuat } from '../travel.mjs';

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
  // were, it stood at 116.6 degrees rather than 90.
  ok(Math.abs(childYaw({ oy: 1, ow: 1 }) - Math.PI / 2) < 1e-9, 'a quarter turn written at any length is a quarter turn');
  ok(Math.abs(childYaw({ oy: 0.7, ow: 0.7 }) - Math.PI / 2) < 1e-9, 'including the 0.7 and 0.7 the scripts write for one');
  const ref = JSON.parse(readFileSync(new URL('../core3ref/travel-buildings.json', import.meta.url), 'utf8')) as { $map: [string, { kind: string; yaw: number }[]][] };
  const theed = ref.$map.find(([t]) => t === 'object/building/naboo/hangar_naboo_theed.iff')?.[1].find((k) => k.kind === 'shuttle');
  // The reference is the emulator's reading and is left as it wrote it: the quarter turn is its value,
  // and a wrong one (see below), which is corrected when the rows are written and never in here.
  ok(!!theed && Math.abs(theed.yaw - Math.PI / 2) < 1e-3, `and the reference in the checkout keeps the emulator's own turn for Theed's transport, which is ours to correct (${theed ? ((theed.yaw * 180) / Math.PI).toFixed(1) : '?'} degrees)`);
}

// ---------------------------------------------------------------- our correction of Theed's turn

{
  // The emulator's quarter turn puts Theed's transport a quarter turn out in its hangar: its only way
  // out for a ship is the doorway at the hangar's own +Z, and the transport's clips fly in and out that
  // way only at a child yaw of 0. The correction is ours and is set on the row, whichever spelling of
  // the building the row names, and set rather than added, so a row corrected twice is the same row.
  ok(shuttleTurnFix('object/building/naboo/hangar_naboo_theed.iff') === 0 && shuttleTurnFix('object/building/naboo/shared_hangar_naboo_theed.iff') === 0, "Theed's hangar is corrected under both of its names");
  ok(shuttleTurnFix('object/building/naboo/shared_starport_naboo.iff') === null && shuttleTurnFix('object/building/military/shared_outpost_starport.iff') === null && shuttleTurnFix(undefined) === null, 'and nothing else is: not the other starports, and not the outposts, which the owner is to look at first');
  ok(Object.keys(SHUTTLE_TURN).length === 1, 'the table of our corrections holds Theed and only Theed');
  const kids = [
    { kind: 'shuttle', model: null, x: 0, y: 7.97928, z: 0, yaw: Math.round((Math.PI / 2) * 1e4) / 1e4, cell: 5 },
    { kind: 'collector', model: '3po_protocol_droid_silver', x: -10, y: 10, z: 0, yaw: -1.5708, cell: 5 },
  ];
  // The live read files one list under both spellings, as `readBuildingChildren` does; the rows it
  // makes are corrected exactly once however many times the correction is run over them.
  const live = new Map([
    ['object/building/naboo/hangar_naboo_theed.iff', kids],
    ['object/building/naboo/shared_hangar_naboo_theed.iff', kids],
  ]);
  const q = [Math.cos(0.7054 / 2), 0, Math.sin(0.7054 / 2), 0];
  const rows = placeChildren([{ template: 'object/building/naboo/shared_hangar_naboo_theed.iff', x: -4795.27, y: 5.95, z: 4238.79, q }], live);
  for (const r of rows) correctShuttleTurn(r);
  const shuttle = rows.find((r: { kind: string }) => r.kind === 'shuttle');
  ok(!!shuttle && shuttle.yaw === 0 && shuttle.cell === 5, "Theed's transport stands at child yaw 0 in its hangar's cell 5, which is the owner's quarter turn back");
  for (const r of rows) correctShuttleTurn(r);
  ok(shuttle?.yaw === 0, 'and corrected twice it is the same, since the correction is set and never added');
  ok(kids[0].yaw === Math.round((Math.PI / 2) * 1e4) / 1e4, "while the children it came from keep the emulator's own turn");
  ok(rows.find((r: { kind: string }) => r.kind === 'collector')?.yaw === -1.5708, "and the collector beside it is not the shuttle's correction to make");
  // One standing out in the open takes the building's turn with it, as `placeChildren` wrote it.
  const outdoor = correctShuttleTurn({ kind: 'shuttle', building: 'object/building/naboo/hangar_naboo_theed.iff', cell: 0, yaw: 9, byaw: 0.5 });
  ok(outdoor.yaw === 0.5, "outdoors it would be the building's own turn composed with ours");
  const other = correctShuttleTurn({ kind: 'shuttle', building: 'object/building/naboo/shared_starport_naboo.iff', cell: 0, yaw: 1.7316, byaw: -1.41 });
  ok(other.yaw === 1.7316, 'and every other shuttle keeps the turn the emulator gave it');
}

// ---------------------------------------------------------------- what a shuttle sounds and shows

{
  // A client effect, laid out as the transport's take-off is, to the byte: its sound, its smoke and
  // the float after it, and the four numbers of its shake.
  const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]);
  const floats = (...v: number[]) => {
    const b = Buffer.alloc(v.length * 4);
    v.forEach((x, i) => b.writeFloatLE(x, i * 4));
    return b;
  };
  const clef = {
    tag: 'FORM',
    type: 'CLEF',
    children: [
      {
        tag: 'FORM',
        type: '0001',
        children: [
          { tag: 'PSND', data: cstr('sound/veh_transport_takeoff.snd') },
          { tag: 'CPAP', data: Buffer.concat([cstr('appearance\\pt_takeoff_radius.prt'), floats(5)]) },
          { tag: 'CAMS', data: floats(0.02, 50, 7, 50) },
          { tag: 'FFBK', data: Buffer.alloc(8) },
        ],
      },
    ],
  };
  const fx = readShuttleEffect(clef);
  ok(fx.sounds.join() === 'sound/veh_transport_takeoff.snd', "a client effect's sound is read");
  ok(fx.particles.length === 1 && fx.particles[0].prt === 'appearance/pt_takeoff_radius.prt' && fx.particles[0].seconds === 5, 'its particle effect with the seconds written after it, the path in the game\'s own slashes');
  ok(fx.shake?.join() === '0.02,50,7,50', 'and its shake as the four numbers the file writes');
  assert.throws(() => readShuttleEffect({ tag: 'FORM', type: 'CLDF', children: [] }));
  ok(true, 'and anything that is not a client effect is refused');

  ok(JSON.stringify(splitHpEvent('hpevent_hp_engine_3_start')) === '{"joint":"hp_engine_3","event":"start"}', "a mark's name is the joint and the event, split at the last underscore");
  ok(JSON.stringify(splitHpEvent('hpevent_root_touchdown')) === '{"joint":"root","event":"touchdown"}' && splitHpEvent('event_footstep') === null, 'and a mark that is not a hardpoint event is not one');
  ok(RIG_FX_ROLES.join() === 'land,lift', 'only the landing and the lift-off are read for marks, never the two one-frame loops');

  // The shuttle's own landing, as its file marks it: the landing sound at frame 225, and the take-off
  // and the ground idle on frame 625, which is one past the clip's last.
  const events = new Set(['land', 'takeoff']);
  const got = rigMarks(
    [
      { name: 'hpevent_root_land', frame: 225 },
      { name: 'hpevent_root_idlground', frame: 625 },
      { name: 'hpevent_root_takeoff', frame: 625 },
      { name: 'hpevent_root_idlground', frame: 10 },
      { name: 'hpevent_tail_land', frame: 20 },
      { name: 'fire1', frame: 30 },
    ],
    { fps: 30, frames: 625 },
    { events, joints: ['ROOT', 'hp_engine_1'] },
  );
  ok(got.marks.length === 1 && got.marks[0].t === 7.5 && got.marks[0].joint === 'ROOT' && got.marks[0].event === 'land', 'the landing sounds 7.5 s in, at the joint as the skeleton spells it');
  ok(got.dropped.end === 2, 'a mark one past the clip\'s last frame is left out, or the lift-off would sound at the moment it touches down');
  ok(got.dropped.unnamed === 1 && got.dropped.joint === 1 && got.dropped.other === 1, 'as is an event the client data does not name, a joint the skeleton lacks, and anything that is not a hardpoint event');
  const doubled = rigMarks([{ name: 'hpevent_root_land', frame: 60 }, { name: 'hpevent_root_land', frame: 60 }], { fps: 30, frames: 100 }, { timeScale: 2 });
  ok(doubled.marks.length === 1 && doubled.marks[0].t === 1, 'a mark written twice is one mark, and a clip the table plays twice as fast marks it twice as soon');
  ok(rigMarks([{ name: 'hpevent_root_land', frame: 1 }], null).marks.length === 0, 'and a clip whose timing cannot be read marks nothing rather than something against a made-up length');
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
    let theedRows = 0;
    let fxRigs = 0;
    for (const planet of ['corellia', 'naboo', 'tatooine', 'talus', 'rori', 'lok', 'dantooine', 'endor', 'yavin4', 'dathomir']) {
      const file = join('assets-private', planet, 'travel.json');
      if (!existsSync(file)) continue;
      type Rig = { file: string; parts: { file: string }[]; ambient?: string | null; events?: Record<string, { sounds?: string[]; particles?: { file: string; seconds: number }[]; shake?: number[] }>; marks?: Record<string, { t: number; joint: string; event: string }[]>; seconds: Record<string, number> };
      const pack = JSON.parse(readFileSync(file, 'utf8')) as { version: number; rigs?: Record<string, Rig>; rows: { kind: string; building: string; model?: string | null; rig?: string; cell: number; x: number; y: number; z: number; yaw: number }[] };
      assert.ok(pack.version === 4, `${planet}: the pack is the shape this build writes (run travel again if not)`);
      // Every shuttle lands on a rig the file carries, and every file the rig names is on disk: the
      // rigs are one folder every world shares, so a world can be current while its pieces have gone.
      for (const r of pack.rows) if (r.kind === 'shuttle') assert.ok(!!r.rig && !!pack.rigs?.[r.rig], `${planet}: a shuttle names a rig the file carries`);
      for (const rig of Object.values(pack.rigs ?? {})) for (const f of [rig.file, ...rig.parts.map((p) => p.file)]) assert.ok(existsSync(join('assets-private', f)), `${planet}: ${f} is on disk`);
      // And what it sounds and shows: an idle loop, events, and marks that name only events it has and
      // fall inside the clips they are filed under, with every effect those events light on disk.
      for (const [id, rig] of Object.entries(pack.rigs ?? {})) {
        assert.ok(!!rig.ambient && rig.events && Object.keys(rig.events).length > 0 && rig.marks && Object.keys(rig.marks).length > 0, `${planet}: the ${id} carries its idle loop, its events and its marks`);
        for (const [clip, marks] of Object.entries(rig.marks ?? {})) {
          for (const m of marks) {
            assert.ok(!!rig.events?.[m.event], `${planet}: the ${id}'s ${clip} marks ${m.event}, which its events answer`);
            assert.ok(m.t >= 0 && m.t < (rig.seconds[clip] ?? 0) + 1e-3, `${planet}: the ${id}'s ${clip} marks ${m.event} at ${m.t} s, inside the clip`);
          }
        }
        for (const ev of Object.values(rig.events ?? {})) for (const p of ev.particles ?? []) assert.ok(p.seconds > 0 && existsSync(join('assets-private', p.file)), `${planet}: ${p.file} is on disk and lit for a while`);
      }
      // Theed's transport, corrected: child yaw 0 in its hangar, the owner's quarter turn back.
      for (const r of pack.rows) if (r.kind === 'shuttle' && /hangar_naboo_theed/.test(r.building)) {
        assert.ok(r.yaw === 0 && r.cell > 0, `${planet}: Theed's transport stands at child yaw 0 in its hangar (${r.yaw})`);
        theedRows++;
      }
      if (pack.rigs?.transport?.marks) fxRigs++;
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
      passed++;
      console.log(`ok   and every rig carries its idle loop, its events and its marks, every mark inside its clip and every effect on disk (${fxRigs} worlds with the transport's)`);
      if (theedRows) {
        passed++;
        console.log(`ok   and Theed's transport stands at child yaw 0 in its hangar (${theedRows} row${theedRows === 1 ? '' : 's'})`);
      } else note("no converted world places Theed's hangar, so its corrected row is not checked on disk");
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
