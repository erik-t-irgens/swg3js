// The doors in the buildings' doorways, both halves of them.
//
//   1. The converter (`tools/swg/doors.mjs`, and `pob.mjs`'s reading of a portal's door): portal files
//      built by hand, byte by byte, whose sides of every version that can carry a door (0002 to 0005)
//      name a style and hang a door, read back; the style table read with its misspelt effect folder put
//      right; a door with no hardpoint hung at its portal's bottom middle whichever order its corners are
//      listed in; the X mirror, which must land a mirrored model hung by a mirrored transform exactly
//      where the client hung the real one; and a pack's table.
//   2. The game's arithmetic (`src/world/doorMath.ts`): the ease, which starts at nought and ends exactly
//      at one whatever the table's numbers and never runs backwards for an ordinary door; a door's
//      steps, which open over the table's own time, sound at the four moments, wait before they close,
//      turn round mid-move with no jump and never close past the frame; where each leaf hangs, the
//      second of a double door turned half way round and never mirrored; and who opens a door -- the
//      bodies near a building, each door's own radius and its release, the locks' seam, the `reach`
//      knob, and which bodies are told to the doors at all.
//   3. The engine (`src/core/physics.ts`, `src/world/doorBody.ts`): the very leaf body the game makes is
//      a wall to the camera, to the fighters' controller, to a gunner's line of fire and to a corpse, and
//      no wall once it is marked so no longer; slid open it is walked through; and a door's first step
//      puts its body in place outright, never sweeping whoever stands in the doorway.
//   4. The owner's packs, where they are on this machine: every door's style and model are there, every
//      door hangs in the plane of its own portal with its slide across it, which is what says the mirror
//      and the reading are both right on the real buildings, almost none is hung for want of a
//      hardpoint, and no style keeps a body walking or running at it waiting long enough for the stuck
//      checks to give up on the door.
//
// Run: node tools/swg/tests/doors.test.ts

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { parseIff } from '../iff.mjs';
import { parsePob } from '../pob.mjs';
import { DOORS_PACK_VERSION as CONVERTER_VERSION, doorModelId, doorsStale, effectPath, fallbackHardpoint, mirrorTransform, packDoorTable, parseDoorStyles, portalDoors } from '../doors.mjs';
import {
  DOOR_EVENT,
  DOORS_PACK_VERSION,
  DOORS_TUNE,
  OPENER,
  doorEase,
  doorWanted,
  gatherOpeners,
  isExitDoor,
  leafAt,
  leafBase,
  leafSlide,
  newDoorMotion,
  openersNear,
  stepDoor,
  type DoorsTune,
} from '../../../src/world/doorMath.ts';
import { DOOR_LEAF_GROUPS, makeLeafBody, moveLeafBody, takeLeafBody } from '../../../src/world/doorBody.ts';
import { Physics, RAPIER } from '../../../src/core/physics.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
const near = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;
const source = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');

// ---------------------------------------------------------------- 1. the converter

const chunk = (tag: string, body: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from(tag.padEnd(4).slice(0, 4), 'latin1'), len, body]);
};
const form = (type: string, ...body: Buffer[]) => chunk('FORM', Buffer.concat([Buffer.from(type.padEnd(4).slice(0, 4), 'latin1'), ...body]));
const cstr = (s: string) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]);
const f32 = (...v: number[]) => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => b.writeFloatLE(x, i * 4));
  return b;
};
const i32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
};
const u8 = (v: number) => Buffer.from([v & 255]);
const IDENTITY_HP = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/**
 * One side of a portal as a cell lists it, in the version given: [0005: disabled], [0002+: passable],
 * geometry, clockwise, target, [0003+: style], [0004+: the hardpoint's flag and its twelve floats,
 * written whether or not the flag is set].
 */
function sideOf(version: number, geometry: number, target: number, style: string, hp: number[] | null, disabled = false): Buffer {
  const parts: Buffer[] = [];
  if (version >= 5) parts.push(u8(disabled ? 1 : 0));
  if (version >= 2) parts.push(u8(1));
  parts.push(i32(geometry), u8(0), i32(target));
  if (version >= 3) parts.push(cstr(style));
  if (version >= 4) parts.push(u8(hp ? 1 : 0), f32(...(hp ?? IDENTITY_HP)));
  return form('PRTL', chunk(String(version).padStart(4, '0'), Buffer.concat(parts)));
}
const side = (geometry: number, target: number, style: string, hp: number[] | null, disabled = false) => sideOf(5, geometry, target, style, hp, disabled);
function cell(name: string, portals: Buffer[]): Buffer {
  return form('CELL', form('0005', chunk('DATA', Buffer.concat([i32(portals.length), u8(0), cstr(name), cstr(`appearance/mesh/${name}.msh`), u8(0)])), ...portals));
}
/** An outline portal (PRTL: a count and the corners in order). */
function outline(...v: number[][]): Buffer {
  return chunk('PRTL', Buffer.concat([i32(v.length), f32(...v.flat())]));
}

// A house: the street (0), a hall (1) and a back room (2). The front door is a style with a hardpoint,
// both sides naming it; the back door names its style on one side only, with no hardpoint, so it is hung
// at its portal; a third portal names a style the table has not got, and a fourth is disabled.
const frontHp = [1, 0, 0, 1.05, 0, 1, 0, 0.84, 0, 0, 1, 6.76];
const pobBytes = form(
  'PRTO',
  form(
    '0004',
    chunk('DATA', Buffer.concat([i32(4), i32(3)])),
    form(
      'PRTS',
      outline([0.05, 0.63, 6.76], [2.04, 0.63, 6.76], [2.04, 4.03, 6.76], [0.05, 4.03, 6.76]),
      // The back door, in the plane x = -4.42, listed the other way round.
      outline([-4.42, 0.7, 6.3], [-4.42, 4.05, 6.3], [-4.42, 4.05, 4.3], [-4.42, 0.7, 4.3]),
      outline([3, 0, 0], [4, 0, 0], [4, 3, 0], [3, 3, 0]),
      outline([5, 0, 0], [6, 0, 0], [6, 3, 0], [5, 3, 0]),
    ),
    form(
      'CELS',
      cell('r0', [side(0, 1, 'house_door', frontHp)]),
      cell('hall', [side(0, 0, 'house_door', frontHp), side(1, 2, '', null), side(2, 2, 'nobody_has_this', null), side(3, 2, 'house_door', frontHp, true)]),
      cell('back', [side(1, 1, 'inner_door', null), side(2, 1, 'nobody_has_this', null), side(3, 1, 'house_door', frontHp, true)]),
    ),
  ),
);
const pob = parsePob(parseIff(pobBytes));
{
  const hall = pob.cells[1].portals;
  ok(hall[0].doorStyle === 'house_door' && hall[0].doorHardpoint?.length === 12 && near(hall[0].doorHardpoint[3], 1.05) && near(hall[0].doorHardpoint[11], 6.76), 'a side of version 0005 reads its door style and its hardpoint after the target cell');
  ok(hall[1].doorStyle === '' && hall[1].doorHardpoint === null, 'a side naming no style and no hardpoint reads as none, though the twelve floats are still written');
  ok(pob.cells[2].portals[0].doorStyle === 'inner_door' && pob.cells[2].portals[0].doorHardpoint === null, 'a styled side whose hardpoint flag is not set has no hardpoint');
}

// The older sides: 0004 (no disabled byte, which is 69% of the retail doors), 0003 (a style and no
// hardpoint at all) and 0002 (neither). Each is read field for field, its target and its geometry right
// after whatever it leaves out, and the doors of a building made of them come out as from 0005.
const oldBytes = form(
  'PRTO',
  form(
    '0004',
    chunk('DATA', Buffer.concat([i32(4), i32(2)])),
    form(
      'PRTS',
      outline([0.05, 0.63, 6.76], [2.04, 0.63, 6.76], [2.04, 4.03, 6.76], [0.05, 4.03, 6.76]),
      outline([-4.42, 0.7, 6.3], [-4.42, 4.05, 6.3], [-4.42, 4.05, 4.3], [-4.42, 0.7, 4.3]),
      outline([3, 0, 0], [4, 0, 0], [4, 3, 0], [3, 3, 0]),
      outline([5, 0, 0], [6, 0, 0], [6, 3, 0], [5, 3, 0]),
    ),
    form(
      'CELS',
      cell('r0', [sideOf(4, 0, 1, 'house_door', frontHp), sideOf(3, 1, 1, 'inner_door', null), sideOf(2, 2, 1, '', null), sideOf(4, 3, 1, 'house_door', null)]),
      cell('hall', [sideOf(4, 0, 0, 'house_door', frontHp), sideOf(3, 1, 0, 'inner_door', null), sideOf(2, 2, 0, '', null), sideOf(4, 3, 0, 'house_door', null)]),
    ),
  ),
);
const old = parsePob(parseIff(oldBytes));
{
  const r0 = old.cells[0].portals;
  ok(r0[0].geometry === 0 && r0[0].target === 1 && !r0[0].disabled && r0[0].doorStyle === 'house_door' && r0[0].doorHardpoint?.length === 12 && near(r0[0].doorHardpoint[3], 1.05) && near(r0[0].doorHardpoint[7], 0.84), 'a side of version 0004, with no disabled byte, reads its target, its style and its hardpoint');
  ok(r0[3].geometry === 3 && r0[3].target === 1 && r0[3].doorStyle === 'house_door' && r0[3].doorHardpoint === null, 'a 0004 side whose flag is not set reads its style and no hardpoint, though its twelve floats are there');
  ok(r0[1].geometry === 1 && r0[1].target === 1 && r0[1].doorStyle === 'inner_door' && r0[1].doorHardpoint === null, 'a side of version 0003 reads its style and carries no hardpoint');
  ok(r0[2].geometry === 2 && r0[2].target === 1 && r0[2].doorStyle === '' && r0[2].doorHardpoint === null && r0[2].passable, 'a side of version 0002 reads its target and carries no door at all');
}

// The style table, as `parseDatatable` hands it over.
const table = {
  rows: [
    { doorStyleName: 'house_door', frameAppearance: '', doorAppearance: 'appearance/door_house.apt', doorAppearance2: '', doorFlip2: 0, doorMoveX: -2.1, doorMoveY: 0, doorMoveZ: 0, openTime: 0.5, closeTime: 0.4, springiness: 1.3, smoothness: 1, triggerRadius: 3, isForceField: 0, openBeginEffect: 'clienteffect/door_open.cef', openEndEffect: '', closeBeginEffect: '', closeEndEffect: 'clienfeffect/door_close.cef' },
    { doorStyleName: 'inner_door', frameAppearance: '', doorAppearance: 'appearance/door_leaf.apt', doorAppearance2: 'appearance/door_leaf.apt', doorFlip2: 1, doorMoveX: 0.9, doorMoveY: 0, doorMoveZ: 0, openTime: 0.15, closeTime: 0.15, springiness: 1, smoothness: 1, triggerRadius: 4, isForceField: 0, openBeginEffect: '', openEndEffect: '', closeBeginEffect: '', closeEndEffect: '' },
    { doorStyleName: 'field', frameAppearance: '', doorAppearance: '', doorAppearance2: '', doorFlip2: 0, doorMoveX: 0, doorMoveY: 0, doorMoveZ: 0, openTime: 0.5, closeTime: 0.5, springiness: 1, smoothness: 1, triggerRadius: 5, isForceField: 1, openBeginEffect: '', openEndEffect: '', closeBeginEffect: '', closeEndEffect: '' },
  ],
};
const { styles, misspelt } = parseDoorStyles(table);
{
  const s = styles.get('house_door')!;
  ok(styles.size === 3 && s.door === 'appearance/door_house.apt' && s.door2 === null && near(s.move[0], -2.1) && s.open === 0.5 && s.close === 0.4 && s.trigger === 3, "a style keeps its models, its slide, its two times and its radius as the table writes them");
  ok(misspelt === 1 && s.effects.closeEnd === 'clienteffect/door_close.cef' && s.effects.openBegin === 'clienteffect/door_open.cef' && s.effects.openEnd === null, 'the misspelt effect folder is read as the real one and counted, and an empty column is no effect');
  ok(styles.get('inner_door')!.flip2 && styles.get('field')!.forceField, 'the second leaf hung turned and the force field are read');
  const fixed = { n: 0 };
  ok(effectPath('clienfeffect\\x.cef', fixed) === 'clienteffect/x.cef' && fixed.n === 1 && effectPath('', fixed) === null, 'a backslashed misspelt path is read the same way');
  ok(doorModelId('appearance/Door_Tato_Filler_S01.apt') === 'door_tato_filler_s01', "a door model's id is its file name, lower case");
}

// The doors of the house.
const doors = portalDoors(pob, styles);
{
  const byPortal = new Map(doors.doors.map((d: { portal: number }) => [d.portal, d]));
  const front = byPortal.get(0) as { style: string; cells: number[]; m: number[]; fallback: boolean };
  ok(doors.doors.length === 2 && !!front && front.style === 'house_door' && front.cells.join() === '0,1' && !front.fallback && near(front.m[7], 0.84), 'the front door: its style, its two cells (the street first, as the street lists it) and its own hardpoint');
  const back = byPortal.get(1) as { style: string; m: number[]; fallback: boolean };
  ok(!!back && back.fallback && back.style === 'inner_door', 'the back door names its style on one side only and carries no hardpoint: hung at its portal');
  ok(doors.counts.missingStyle === 1 && doors.counts.disabled === 1 && doors.counts.noHardpoint === 1, 'a style the table has not got and a disabled portal are passed over and counted');
  // Hung at the portal's bottom middle, upright, its Z along the portal's normal (x here) and its X across the doorway.
  const m = back.m;
  ok(near(m[3], -4.42) && near(m[7], 0.7) && near(m[11], 5.3), 'a door with no hardpoint hangs at the bottom middle of its portal');
  ok(near(Math.abs(m[2]), 1) && near(m[5], 1) && near(Math.abs(m[8]), 1) && near(m[0], 0) && near(m[10], 0), 'upright, its Z along the portal normal and its X along the doorway');
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  ok(near(det, 1), 'and a proper turn, not a mirror');
}
{
  // The same doors out of the older sides: the 0004 hardpoint is taken, the 0003 style is hung at its portal.
  const got = portalDoors(old, styles);
  const byPortal = new Map(got.doors.map((d: { portal: number }) => [d.portal, d]));
  const front = byPortal.get(0) as { style: string; m: number[]; fallback: boolean } | undefined;
  const back = byPortal.get(1) as { style: string; fallback: boolean } | undefined;
  const plain = byPortal.get(3) as { style: string; fallback: boolean } | undefined;
  ok(got.doors.length === 3 && !!front && !front.fallback && near(front.m[3], 1.05) && !!back && back.fallback && back.style === 'inner_door' && !!plain && plain.fallback && !byPortal.has(2), "a building of 0004, 0003 and 0002 sides: the 0004 door on its own hardpoint, the 0003 door and the flagless 0004 door at their portals, and none where the 0002 side names nothing");
}
{
  // The same rectangle listed as two triangles whose corners come in no order round its edge (`IDTL`).
  const verts = [[0, 0, 2], [3, 3, 2], [3, 0, 2], [0, 3, 2]];
  const m = fallbackHardpoint(verts, [0, 2, 1, 0, 1, 3]);
  ok(!!m && near(m[3], 1.5) && near(m[7], 0) && near(m[11], 2) && near(Math.abs(m[10]), 1), 'a polygon kept as triangles is hung by its triangles, whatever order its corners are listed in');
  ok(fallbackHardpoint([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, 1, 2, 0, 2, 3]) === null, 'a portal lying flat has no upright plane for a door: none');
}
{
  // The mirror: a model converted with X mirrored, hung by the mirrored transform, lands exactly where
  // the client hung the real model, mirrored.
  const m = [0.6, 0, 0.8, 3, 0, 1, 0, 1, -0.8, 0, 0.6, -7];
  const apply = (t: number[], v: number[]) => [t[0] * v[0] + t[1] * v[1] + t[2] * v[2] + t[3], t[4] * v[0] + t[5] * v[1] + t[6] * v[2] + t[7], t[8] * v[0] + t[9] * v[1] + t[10] * v[2] + t[11]];
  const v = [0.4, 2.2, -0.1];
  const client = apply(m, v);
  const game = apply(mirrorTransform(m), [-v[0], v[1], v[2]]);
  ok(near(game[0], -client[0]) && near(game[1], client[1]) && near(game[2], client[2]), 'a mirrored model hung by the mirrored transform lands on the mirror of where the client hung it');
  ok(mirrorTransform(mirrorTransform(m)).every((x, i) => near(x, m[i])), 'mirroring twice is no mirror');
}
{
  // A pack's table: every portal model with its doors, the styles they use with their models by id, the
  // slide mirrored with the meshes and each moment's sounds out of its client effects.
  const defs = [
    { id: 'house', source: 'appearance/house.pob', cells: [{}] },
    { id: 'shed', source: 'appearance/shed.pob', cells: [{}] },
    { id: 'rock', source: 'appearance/rock.apt' },
  ];
  const reader = (path: string) => (path === 'appearance/house.pob' ? doors : path === 'appearance/shed.pob' ? { doors: [], counts: {} } : { error: 'no' });
  const sounds: Record<string, string[]> = { 'clienteffect/door_open.cef': ['sound/open.snd'], 'clienteffect/door_close.cef': ['sound/close_a.snd', 'sound/close_b.snd'] };
  const exists = (a: string) => a !== 'appearance/missing.apt';
  const { file, counts, appearances } = packDoorTable(defs, reader, styles, { flipX: true, exists, soundsOf: (cef: string) => sounds[cef] ?? [] });
  ok(file.version === CONVERTER_VERSION && file.models.house.length === 2 && Array.isArray(file.models.shed) && file.models.shed.length === 0 && !('rock' in file.models), 'every portal model is written, one with no doors as an empty list, and no plain model at all');
  const front = file.models.house.find((d: { portal: number }) => d.portal === 0);
  ok(near(front.m[3], -1.05) && near(front.m[11], 6.76), "a door's transform is mirrored in X with the meshes");
  const hd = file.styles.house_door;
  ok(hd.door === 'door_house' && near(hd.move[0], 2.1) && hd.sounds.openBegin?.[0] === 'sound/open.snd' && hd.sounds.closeEnd?.length === 2 && !hd.sounds.openEnd, "a style's model by id, its slide mirrored, and the sounds each moment's effect names");
  ok(file.styles.inner_door.door === 'door_leaf' && file.styles.inner_door.door2 === 'door_leaf' && file.styles.inner_door.flip2, 'a double door names its leaf twice, the second turned');
  ok(counts.buildings === 2 && counts.withDoors === 1 && counts.doors === 2 && counts.fallback === 1 && appearances.sort().join() === 'appearance/door_house.apt,appearance/door_leaf.apt', 'the counts, and the models to convert');
  ok(file.models.house.find((d: { portal: number; fallback?: boolean }) => d.portal === 1)?.fallback === true, 'a door hung at its portal says so');
  // A door whose every leaf is missing from the archives draws nothing and is left out.
  const missing = new Map(styles);
  missing.set('house_door', { ...styles.get('house_door'), door: 'appearance/missing.apt' });
  const without = packDoorTable(defs, reader, missing, { exists });
  ok(without.file.models.house.length === 1 && without.counts.noModel === 1, 'a door with no model in the archives is left out and counted');
  // Stale or not.
  const models = new Set(['door_house', 'door_leaf']);
  ok(doorsStale(null) === 'none' && doorsStale({ version: 0, models: {}, styles: {} }) === 'older', 'no table, or an older one, is asked for again');
  ok(doorsStale(file, { tableMtime: 2, manifestMtime: 3, models }) === 'stale' && doorsStale(file, { tableMtime: 3, manifestMtime: 2, models }) === null, 'a world converted again after its table was written is asked for again');
  ok(doorsStale(file, { tableMtime: 3, manifestMtime: 2, models: new Set(['door_house']) }) === 'no model door_leaf', 'a table naming a door model the shared folder has not got is asked for again');
}
{
  // `status` asks for the door models again when the material format moves on, as it does for every
  // other command that writes models (read off cli.mjs: its status block is not a function a test can call).
  const cli = source('tools/swg/cli.mjs');
  ok(/doorModels && \(doorModels\.materialFormat \?\? 1\) < MATERIAL_FORMAT/.test(cli), "status compares the door models' material format with the current one");
}

// ---------------------------------------------------------------- 2. the game's arithmetic

ok(DOORS_PACK_VERSION === CONVERTER_VERSION, `the game reads the shape of doors.json the converter writes (${DOORS_PACK_VERSION} and ${CONVERTER_VERSION})`);
{
  const tune: DoorsTune = { ...DOORS_TUNE };
  for (const spring of [0.45, 0.5, 0.8, 1, 1.3, 2]) {
    for (const smooth of [0, 0.5, 1]) {
      assert.ok(doorEase(0, spring, smooth, tune) === 0 && near(doorEase(1, spring, smooth, tune), 1, 1e-12), `ends at ${spring}, ${smooth}`);
    }
  }
  ok(true, 'the ease is nought at the start and exactly one at the end for every springiness and smoothness the table holds');
  let backwards = 0;
  for (const spring of [0.45, 0.5, 0.8, 1, 1.1, 1.2]) {
    for (const smooth of [0, 0.5, 1]) {
      let last = 0;
      for (let i = 1; i <= 400; i++) {
        const f = doorEase(i / 400, spring, smooth, tune);
        if (f < last - 1e-12) backwards++;
        last = f;
      }
    }
  }
  ok(backwards === 0, 'a door of springiness up to 1.2 never runs backwards');
  let peak = 0;
  for (let i = 0; i <= 1000; i++) peak = Math.max(peak, doorEase(i / 1000, 1.3, 1, tune));
  ok(peak > 1.005 && peak < 1.03, `the table's usual springiness of 1.3 runs a leaf a little past its stop and back (${((peak - 1) * 100).toFixed(1)}% of its slide)`);
  ok(doorEase(0.5, 0.5, 1, tune) < doorEase(0.5, 1, 1, tune), 'a heavy door (springiness 0.5) lags behind an ordinary one half way through');
  ok(near(doorEase(0.3, 1.3, 1, { ...tune, spring: 0 }), doorEase(0.3, 1, 1, tune)), 'with the tune at nought every door eases alike');
  ok(near(doorEase(0.25, 1, 0, tune), 0.25), 'smoothness nought is a constant speed');
}
{
  const tune: DoorsTune = { ...DOORS_TUNE, linger: 0.3 };
  const s = { open: 0.5, close: 0.4, spring: 1, smooth: 1 };
  const d = newDoorMotion();
  const dt = 1 / 60;
  let events = 0;
  let t = 0;
  let opened = -1;
  events |= stepDoor(d, true, dt, s, tune);
  ok((events & DOOR_EVENT.openBegin) !== 0 && d.moving && d.target === 1, 'a body near a shut door: it begins to open, and says so');
  t = dt;
  for (let i = 0; i < 120 && opened < 0; i++) {
    const e = stepDoor(d, true, dt, s, tune);
    t += dt;
    if (e & DOOR_EVENT.openEnd) opened = t;
  }
  ok(opened > 0.45 && opened < 0.55 && d.open === 1 && !d.moving, `it is fully open after the table's own open time (${opened.toFixed(3)} s of 0.5)`);
  // Nobody near: it waits `linger`, then closes over the close time.
  let closeAt = -1;
  t = 0;
  for (let i = 0; i < 60 && closeAt < 0; i++) {
    const e = stepDoor(d, false, dt, s, tune);
    t += dt;
    if (e & DOOR_EVENT.closeBegin) closeAt = t;
  }
  ok(closeAt > 0.28 && closeAt < 0.34, `it waits ${tune.linger} s with nobody near before it closes (${closeAt.toFixed(3)} s)`);
  // Half way shut, a body comes back: it turns round from where it stands.
  for (let i = 0; i < 12; i++) stepDoor(d, false, dt, s, tune);
  const mid = d.open;
  const e = stepDoor(d, true, dt, s, tune);
  ok(mid > 0.2 && mid < 0.8 && (e & DOOR_EVENT.openBegin) !== 0 && Math.abs(d.open - mid) < 0.05, `a body coming back turns a closing door round from where it stands (${mid.toFixed(2)} open), with no jump`);
  let back = 0;
  for (let i = 0; i < 120 && d.moving; i++) {
    stepDoor(d, true, dt, s, tune);
    back += dt;
  }
  ok(back < 0.5 * (1 - mid) + 0.05, `and takes only the share of its open time the distance left asks (${back.toFixed(3)} s)`);
  // A springy door never closes past its frame.
  const spr = { open: 0.5, close: 0.5, spring: 2, smooth: 1 };
  const q = newDoorMotion();
  q.open = 1;
  q.from = 1;
  q.target = 1;
  let low = 1;
  let over = 1;
  for (let i = 0; i < 120; i++) {
    stepDoor(q, false, dt, spr, { ...tune, linger: 0 });
    low = Math.min(low, q.open);
  }
  const r = newDoorMotion();
  for (let i = 0; i < 120; i++) {
    stepDoor(r, true, dt, spr, tune);
    over = Math.max(over, r.open);
  }
  ok(low === 0 && q.open === 0 && over > 1, 'a springy door runs past fully open and comes back, and never closes past its frame');
  // Nothing while it stands still.
  const still = newDoorMotion();
  ok(stepDoor(still, false, dt, s, tune) === 0 && still.open === 0 && !still.moving, 'a shut door nobody is near does nothing at all');
}
{
  // Where the leaves hang: a building turned a quarter round, a door hung in it, its second leaf flipped.
  const building = new THREE.Matrix4().compose(new THREE.Vector3(100, 5, -20), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1));
  const m = [1, 0, 0, 2, 0, 1, 0, 0.5, 0, 0, 1, 3];
  const a = leafBase(building, m, false, new THREE.Matrix4());
  const b = leafBase(building, m, true, new THREE.Matrix4());
  const at = new THREE.Vector3().setFromMatrixPosition(a);
  const expect = new THREE.Vector3(2, 0.5, 3).applyMatrix4(building);
  ok(at.distanceTo(expect) < 1e-6, 'a leaf hangs at the building times its hardpoint');
  const slideA = leafSlide(a, [0.9, 0, 0], new THREE.Vector3());
  const slideB = leafSlide(b, [0.9, 0, 0], new THREE.Vector3());
  ok(slideA.distanceTo(slideB.clone().negate()) < 1e-6 && near(slideA.length(), 0.9), 'the second leaf, hung turned, slides the other way: the two part in the middle');
  ok(near(new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(building)).dot(slideA) / 0.9, 1), "and the slide runs along the leaf's own X, turned with the building");
  // Turned, never mirrored and never upside down: the second leaf is the first times half a turn about
  // its own up -- its up column the same, its X and Z columns the other way, its place the same, and a
  // proper turn (determinant +1), or its body's turn would not be its mesh's.
  const ea = a.elements;
  const eb = b.elements;
  const halfTurn = new THREE.Matrix4().multiplyMatrices(a, new THREE.Matrix4().makeRotationY(Math.PI));
  ok(near(eb[4], ea[4]) && near(eb[5], ea[5]) && near(eb[6], ea[6]) && near(eb[0], -ea[0]) && near(eb[1], -ea[1]) && near(eb[2], -ea[2]) && near(eb[8], -ea[8]) && near(eb[9], -ea[9]) && near(eb[10], -ea[10]) && near(eb[12], ea[12]) && near(eb[13], ea[13]) && near(eb[14], ea[14]), "the second leaf keeps its up and its place and turns its X and Z the other way");
  ok(near(b.determinant(), 1) && b.elements.every((v, i) => near(v, halfTurn.elements[i])), 'and is the first turned half way round about its own up: a proper turn, not a mirror');
  const riseA = leafSlide(a, [0, 2, 0], new THREE.Vector3());
  const riseB = leafSlide(b, [0, 2, 0], new THREE.Vector3());
  ok(riseA.distanceTo(riseB) < 1e-6 && near(riseA.y, 2), 'a double door that rises lifts both its leaves the same way');
  const half = leafAt(a, slideA, 0.5, new THREE.Matrix4());
  ok(new THREE.Vector3().setFromMatrixPosition(half).distanceTo(at.clone().addScaledVector(slideA, 0.5)) < 1e-6, 'half open is half the slide on from where it hangs shut');
  ok(isExitDoor([0, 3]) && isExitDoor([4, 0]) && !isExitDoor([2, 3]), 'a door is a door to the world when either side is the exterior');
}
{
  // Who opens a door: one door at (10, 0, 0) with the table's usual radius of 3.
  const tune: DoorsTune = { ...DOORS_TUNE, reach: 1, release: 0.5 };
  const xyz = new Float64Array(3 * 8);
  const kind = new Uint8Array(8);
  const nearList = new Int32Array(8);
  const put = (i: number, x: number, y: number, z: number, k: number) => {
    xyz[i * 3] = x;
    xyz[i * 3 + 1] = y;
    xyz[i * 3 + 2] = z;
    kind[i] = k;
    nearList[i] = i;
  };
  const counts = { refused: 0 };
  const door = { name: 'the door' };
  const wants = (m: number, open: boolean, ask: ((d: typeof door, who: number) => boolean) | null = null, t: DoorsTune = tune) => doorWanted(door, 10, 0, 0, 3, open, xyz, kind, nearList, m, ask, counts, t);
  put(0, 12.99, 0, 0, OPENER.player);
  ok(wants(1, false), 'a body just inside the radius opens a shut door');
  put(0, 13.01, 0, 0, OPENER.player);
  ok(!wants(1, false), 'and one just outside it does not');
  put(0, 10, 3.2, 0, OPENER.player);
  ok(!wants(1, false), 'the radius is measured in three dimensions, from the bottom middle of the doorway: a body on the floor above does not open it');
  put(0, 13.3, 0, 0, OPENER.player);
  ok(!wants(1, false) && wants(1, true), `inside the release (${tune.release} m past the radius) a body holds an open door open, but does not open a shut one`);
  put(0, 13.6, 0, 0, OPENER.player);
  ok(!wants(1, true), 'and past the release it lets go');
  // The locks' seam.
  put(0, 11, 0, 0, OPENER.player);
  ok(!wants(1, false, () => false) && counts.refused === 1, 'a lock that refuses keeps the door shut, and the refusal is counted');
  ok(
    !wants(1, false, () => {
      throw new Error('a broken lock');
    }) && counts.refused === 2,
    'a lock that throws keeps its own door shut and is counted, and nothing else is the worse for it',
  );
  put(1, 11.5, 0, 0.5, OPENER.mobile);
  ok(wants(2, false, (_d, who) => who === OPENER.mobile) && counts.refused === 3, 'a lock that lets one kind of body through: the player refused, the creature beside them let in');
  ok(wants(2, false, (d) => d === door), 'the lock is asked about this door, by name');
  // Far bodies are never asked about: the lock is asked only of a body already within the radius.
  let asked = 0;
  put(0, 30, 0, 0, OPENER.player);
  put(1, 40, 0, 0, OPENER.mobile);
  ok(
    !wants(2, false, () => {
      asked++;
      return true;
    }) && asked === 0,
    'a body outside the radius is never put to the lock',
  );
  // The reach knob scales the radius.
  put(0, 12, 0, 0, OPENER.player);
  ok(!wants(1, false, null, { ...tune, reach: 0.5 }) && wants(1, false, null, { ...tune, reach: 1 }), 'the reach knob multiplies the radius: 2 m out opens at full reach and not at half');
}
{
  // The bodies near a building: one whose farthest door stands 20 m from its middle.
  const xyz = new Float64Array(3 * 4);
  const out = new Int32Array(4);
  const tune: DoorsTune = { ...DOORS_TUNE, release: 0.5 };
  // At the door, 2.9 m past it, 4.3 m past it, and by the building's middle.
  xyz.set([20, 0, 0, 22.9, 0, 0, 24.3, 0, 0, 0, 0, 5]);
  let m = openersNear(0, 0, 20, 3, xyz, 4, out, { ...tune, reach: 1 });
  let got = [...out.slice(0, m)];
  ok(got.join() === '0,1,3', `at full reach the bodies within the farthest door, its radius and the release (23.5 m) are near the building, and no farther (${got.join(',')})`);
  m = openersNear(0, 0, 20, 3, xyz, 4, out, { ...tune, reach: 0.5 });
  got = [...out.slice(0, m)];
  ok(got.join() === '0,3', `at half reach a body standing at the door 20 m out is still near the building -- the knob scales the radius and never the building's size (${got.join(',')})`);
  // And the door then opens for it: the two filters agree at any reach.
  const kind = new Uint8Array(4);
  ok(doorWanted({}, 20, 0, 0, 3, false, xyz, kind, out, m, null, { refused: 0 }, { ...tune, reach: 0.5 }), 'so a door far from its building\'s middle opens with the knob turned down');
}
{
  // Which bodies are told to the doors at all.
  const told: [number, number][] = [];
  let began = 0;
  const sink = {
    beginOpeners: () => {
      began++;
      told.length = 0;
    },
    addOpener: (x: number, _y: number, _z: number, k: number) => {
      told.push([x, k]);
    },
  };
  const at = (x: number) => ({ x, y: 0, z: 0 });
  const mobiles = [
    { pos: at(1), dead: false, ready: true, removed: false },
    { pos: at(2), dead: false, ready: false, removed: false },
    { pos: at(3), dead: false, ready: true, removed: true },
    { pos: at(4), dead: true, ready: true, removed: false },
  ];
  const fighters = [
    { pos: at(5), dead: false },
    { pos: at(6), dead: true },
  ];
  const peers = [
    { pos: at(7), dead: false },
    { pos: at(8), dead: true },
  ];
  gatherOpeners(sink, at(0), mobiles, fighters, peers);
  ok(began === 1 && JSON.stringify(told) === JSON.stringify([[0, OPENER.player], [1, OPENER.mobile], [5, OPENER.fighter], [7, OPENER.peer]]), 'the player, a person or creature with its model up and in the world, a fighter and a peer open doors; the dead, the unready and the removed do not');
  gatherOpeners(sink, null, null, fighters, peers);
  ok(began === 2 && JSON.stringify(told) === JSON.stringify([[5, OPENER.fighter], [7, OPENER.peer]]), "a player standing in a hull's rooms opens no door of the world, and the list starts afresh every step");
  // The world tells the doors exactly that (read off world.ts, which node cannot load).
  ok(/gatherOpeners\(doors, this\.aboard \? null : playerPos, this\.mobiles\?\.live, this\.npcs\.npcs, this\.peers\(\)\.standing\)/.test(source('src/world/world.ts')), 'and the world tells the doors the player (unless aboard), the catalogue, the fighters and the peers');
  const doorsSrc = source('src/world/doors.ts');
  ok(/openersNear\(b\.x, b\.z, rec\.spread, rec\.trigger,/.test(doorsSrc) && /doorWanted<DoorView>\(d, d\.ox, d\.oy, d\.oz, d\.s\.trigger, d\.motion\.target === 1,[^;]*this\.mayOpen/.test(doorsSrc), "and the doors' step asks these very functions, with the locks' seam");
}

// ---------------------------------------------------------------- 3. the engine

{
  const physics = await Physics.create();
  // The game's own leaf: a door hung at the origin, its box 2 m wide, 3 m tall and the least depth thick.
  const shut = new THREE.Matrix4();
  const box = { mid: [0, 1.5, 0], half: [1, 1.5, DOORS_TUNE.minDepth] };
  const { body, collider } = makeLeafBody(physics, shut, box, true);
  ok(body.isKinematic() && collider.collisionGroups() === DOOR_LEAF_GROUPS && physics.isWall(collider.handle) && collider.isEnabled(), 'a leaf is a kinematic body with one box, in the rooms\' group, marked a wall');
  physics.stepOnce();
  const from = { x: 0, y: 1.5, z: 3 };
  const to = { x: 0, y: 1.5, z: -3 };
  const hit = physics.cameraBlock(from, to, null, true);
  ok(hit !== null && near(hit, 3 - DOORS_TUNE.minDepth, 0.05), 'a shut door is a wall to the camera, indoors and out, though its body is kinematic');
  ok(physics.segmentBlocked(from, to, true, true) && physics.segmentBlocked(from, to, false, true), "a shut door blocks a gunner's line of fire and a lamp's sight (`segmentBlocked` with walls)");
  ok(!physics.segmentBlocked(from, to, true), 'and not the doorway test of who can reach whom, which asks without walls: the nav does not see doors');
  physics.markWall(collider, false);
  ok(physics.cameraBlock(from, to, null, true) === null && !physics.segmentBlocked(from, to, true, true), 'and nothing that moves is, without the mark');
  physics.markWall(collider, true);
  // A walker stopping at what the fighters' character controller stops at: the very predicate it passes.
  const walker = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 2));
  const capsule = physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.45, 0.35), walker);
  const controller = physics.world.createCharacterController(0.02);
  physics.stepOnce();
  controller.computeColliderMovement(capsule, { x: 0, y: 0, z: -3 }, undefined, undefined, physics.stillOrWall);
  const stopped = controller.computedMovement().z;
  ok(stopped > -1.6, `a walker stops at the shut door with the predicate the fighters' controller passes (${stopped.toFixed(2)} m of 3)`);
  // Slid aside, as the door does: the body is moved, never removed.
  moveLeafBody(body, { x: 2.3, y: 0, z: 0 }, false);
  physics.stepOnce();
  controller.computeColliderMovement(capsule, { x: 0, y: 0, z: -3 }, undefined, undefined, physics.stillOrWall);
  const through = controller.computedMovement().z;
  ok(through < -2.9, `and walks through once it has slid open (${through.toFixed(2)} m of 3)`);
  physics.world.removeCharacterController(controller);
  takeLeafBody(physics, body, collider);
  ok(!physics.isWall(collider.handle) && !body.isValid(), 'a leaf taken down leaves no wall mark and no body');
  takeLeafBody(physics, body, collider);
  ok(physics.broken === null, 'and taking it down twice is no panic');
  // The fighters and the mobiles ask that predicate (read off their sources, which node cannot load).
  const npcs = source('src/world/npcs.ts');
  ok(/computeColliderMovement\([^;]*this\.physics\.stillOrWall\)/.test(npcs), "the fighters' controller passes `Physics.stillOrWall`");
  ok(/segmentBlocked\(LINE_FROM, LINE_TO, !!this\.cell, true\)/.test(npcs), "a fighter's line of fire counts a shut door");
  ok(/private lineTo\(t: Living\)[\s\S]{0,900}?this\.deps\.physics\.stillOrWall/.test(source('src/world/mobiles/mobile.ts')), "a mobile's line of fire counts a shut door");
}
{
  // A door's first step: somebody stands in the doorway as its building's rooms come up (a follower
  // arriving with the player), the door is made shut and its first step stands it open. Jumped there, its
  // body arrives with no velocity at all and the visitor is left where they stood; slid there, the engine
  // takes the 2.3 m as one step's motion, a hundred and thirty-eight metres a second, which is what any
  // contact with it that step would be handed. (Measured, the engine's own solver does not then throw an
  // overlapping body at that speed -- its velocity comes out of the step at nought either way -- so the
  // jump is the right pose rather than the cure for a shove that was seen.)
  const run = (jump: boolean): { leaf: number; visitor: number; at: number } => {
    const w = Physics.local(0);
    const { body } = makeLeafBody(w, new THREE.Matrix4(), { mid: [0, 1.5, 0], half: [1, 1.5, DOORS_TUNE.minDepth] }, true);
    const visitor = w.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0.3, 1, 0));
    w.world.createCollider(RAPIER.ColliderDesc.ball(0.35), visitor);
    moveLeafBody(body, { x: 2.3, y: 0, z: 0 }, jump);
    w.stepOnce();
    const lv = body.linvel();
    const v = visitor.linvel();
    return { leaf: Math.hypot(lv.x, lv.y, lv.z), visitor: Math.hypot(v.x, v.y, v.z), at: body.translation().x };
  };
  const jumped = run(true);
  const slid = run(false);
  ok(near(jumped.at, 2.3, 1e-4) && jumped.leaf < 1e-3 && jumped.visitor < 0.01, `a door's first step puts its body in place outright, with no velocity (${jumped.leaf.toFixed(3)} m/s), and the body standing in the doorway is left alone`);
  ok(near(slid.at, 2.3, 1e-4) && slid.leaf > 100, `where sliding it there is a whole slide in one step (${slid.leaf.toFixed(0)} m/s)`);
  ok(/this\.pose\(d, true\)/.test(source('src/world/doors.ts')), "and the doors' first step is the jump");
}
{
  // A corpse meets a shut door as it meets a wall: a ragdoll piece thrown at a leaf lands against it.
  const run = (wall: boolean): number => {
    const w = Physics.local(0);
    const { collider } = makeLeafBody(w, new THREE.Matrix4(), { mid: [0, 1.5, 0], half: [1, 1.5, DOORS_TUNE.minDepth] }, true);
    if (!wall) w.markWall(collider, false);
    const piece = w.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.5, 1.5).setLinvel(0, 0, -6));
    const c = w.world.createCollider(RAPIER.ColliderDesc.ball(0.2).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), piece);
    w.markRagdoll(c, w.nextRagdollGroup());
    for (let i = 0; i < 40; i++) w.stepOnce();
    return piece.translation().z;
  };
  const against = run(true);
  const unmarked = run(false);
  ok(against > 0, `a corpse thrown at a shut door lands against it (${against.toFixed(2)} m in front of the leaf)`);
  ok(unmarked < -0.5, `where a kinematic body not marked a wall is a mover it passes through (${unmarked.toFixed(2)} m): the wall mark is what stops it`);
}

// ---------------------------------------------------------------- 4. the owner's packs

{
  const root = fileURLToPath(new URL('../../../assets-private/', import.meta.url));
  const shared = join(root, 'doors', 'manifest.json');
  if (!existsSync(shared)) note('no assets-private/doors on this machine: the packs are not checked');
  else {
    const man = JSON.parse(readFileSync(shared, 'utf8'));
    const models = new Map<string, { min: number[]; max: number[] }>();
    for (const d of (man.categories?.doors ?? []) as { id: string; bounds: { min: number[]; max: number[] } }[]) models.set(d.id, d.bounds);
    ok(man.version === DOORS_PACK_VERSION && models.size > 0, `the shared door models: ${models.size}, in the shape the game reads`);
    let tables = 0;
    let total = 0;
    let fallback = 0;
    /** The one building whose doors stand on sides that name no hardpoint, and the doors of any other that do. */
    const STAR_DESTROYER_ROOMS = 'thm_spc_star_destroyer_s01';
    const sdFallback = new Map<string, number>();
    const otherFallback: string[] = [];
    let unknown = 0;
    let measured = 0;
    let inPlane = 0;
    let across = 0;
    let acrossX = 0;
    let worstPlane = 0;
    let worstAcross = 0;
    type StyleRow = { door: string | null; door2: string | null; move: number[]; open: number; spring: number; smooth: number; trigger: number };
    const styleRows = new Map<string, StyleRow>();
    for (const d of readdirSync(root, { withFileTypes: true })) {
      const f = join(root, d.name, 'doors.json');
      if (!d.isDirectory() || !existsSync(f)) continue;
      const t = JSON.parse(readFileSync(f, 'utf8'));
      const manifest = JSON.parse(readFileSync(join(root, d.name, 'manifest.json'), 'utf8'));
      const defs = new Map<string, { portals?: { v: number[][]; i: number[] }[] }>();
      for (const list of Object.values(manifest.categories ?? {}) as { id: string }[][]) for (const def of list) defs.set(def.id, def);
      tables++;
      for (const [name, s] of Object.entries(t.styles)) styleRows.set(name, s as StyleRow);
      for (const [model, rows] of Object.entries(t.models) as [string, { portal: number; style: string; m: number[]; fallback?: boolean }[]][]) {
        for (const row of rows) {
          total++;
          if (row.fallback) {
            fallback++;
            if (model === STAR_DESTROYER_ROOMS) sdFallback.set(d.name, (sdFallback.get(d.name) ?? 0) + 1);
            else otherFallback.push(`${d.name}/${model}`);
          }
          const s = t.styles[row.style];
          if (!s || ![s.door, s.door2, s.frame].filter(Boolean).every((id: string) => models.has(id))) unknown++;
          // In the plane of its own portal (from the manifest, mirrored as the door is), sliding across it.
          const poly = defs.get(model)?.portals?.[row.portal];
          if (!poly || poly.i.length < 3 || row.fallback || !s) continue;
          const [a, b, c] = [poly.v[poly.i[0]], poly.v[poly.i[1]], poly.v[poly.i[2]]].map((v) => new THREE.Vector3(v[0], v[1], v[2]));
          const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
          if (!(n.length() > 1e-6)) continue;
          n.normalize();
          measured++;
          const origin = new THREE.Vector3(row.m[3], row.m[7], row.m[11]);
          const dist = Math.abs(n.dot(origin.sub(a)));
          worstPlane = Math.max(worstPlane, dist);
          if (dist < 0.5) inPlane++;
          // The slide itself, the style's move through the row's own turn: across the portal, never through it.
          const m = row.m;
          const mv = s.move as number[];
          const slide = new THREE.Vector3(m[0] * mv[0] + m[1] * mv[1] + m[2] * mv[2], m[4] * mv[0] + m[5] * mv[1] + m[6] * mv[2], m[8] * mv[0] + m[9] * mv[1] + m[10] * mv[2]);
          const through = slide.length() > 1e-6 ? Math.abs(n.dot(slide)) / slide.length() : 0;
          worstAcross = Math.max(worstAcross, through);
          if (through < 0.2) across++;
          if (Math.abs(new THREE.Vector3(m[0], m[4], m[8]).dot(n)) < 0.2) acrossX++;
        }
      }
    }
    ok(tables > 0 && unknown === 0, `${tables} packs, ${total} doors: every one names a style its table carries and models the shared folder has`);
    ok(measured > 0 && inPlane / measured > 0.97, `${inPlane} of ${measured} doors with a hardpoint hang within half a metre of their own portal's plane (worst ${worstPlane.toFixed(2)} m): the mirror and the reading agree with the buildings`);
    ok(measured > 0 && across === measured, `all ${across} of ${measured} slide across their portal, not through it (the slide, the style's move through the row's turn, at worst ${(Math.asin(Math.min(1, worstAcross)) * 180 / Math.PI).toFixed(1)} degrees off the portal's plane)`);
    note(`${acrossX} of ${measured} have their own X across the portal; the rest rise, sink or slide along another axis of their own`);
    // Every door hangs on its own hardpoint but the heroic Star Destroyer's: a reading that lost the
    // hardpoints of a version (69% of the retail doors stand on 0004 sides) would hang most of them at their
    // portals instead. The Star Destroyer's sides name none, 33 of them, and since the instances zone was
    // converted that building stands in two packs, the gallery's and the zone's: 66 of 2,162, every one of
    // them those same 33 sides. So no other building may lose one, and that one no more than its 33 a pack.
    ok(total > 0 && otherFallback.length === 0, `no door but the Star Destroyer's hangs at its portal for want of a hardpoint (${otherFallback.length ? otherFallback.slice(0, 4).join(', ') : 'none'})`);
    ok([...sdFallback.values()].every((n) => n <= 33), `and the Star Destroyer's no more than its own 33 sides in any pack (${[...sdFallback].map(([p, n]) => `${n} in ${p}`).join(', ') || 'none here'}; ${fallback} of ${total} in all, ${((100 * fallback) / Math.max(1, total)).toFixed(1)}%)`);
    // As measured when the doors were first written: 17 packs, 2,034 doors. A reading that dropped the
    // styles of a version would leave most of them out.
    if (tables >= 17) ok(total >= 0.95 * 2034, `with the ${tables} packs measured, ${total} doors stand: no version's styles have been lost (2,034 measured)`);
    else note(`${tables} packs: fewer than the 17 measured, so the door total is not held to the 2,034 measured`);

    // How long a body walking or running straight at a door waits for its leaf to clear its path, style
    // by style: from the moment it comes within the radius (the door begins to open) to the moment the
    // leaf has slid, risen or sunk out of a body's way. The body is the player's own capsule, which the
    // fighters share (0.35 m across the middle of the doorway, its top 1.6 m up, a 0.5 m step under it),
    // at the player's walk and run (2 and 5.5 m/s). A wait as long as the stuck checks' patience -- their
    // window less the share of it a body must cover, read off their sources -- would have a body side-step
    // at the door instead of waiting for it.
    const npcsSrc = source('src/world/npcs.ts');
    const mobileSrc = source('src/world/mobiles/mobile.ts');
    const fighterWindow = Number(/stuckWindow: ([0-9.]+)/.exec(npcsSrc)?.[1]);
    const fighterShare = Number(/stuckShare: ([0-9.]+)/.exec(npcsSrc)?.[1]);
    const mobileWindow = Number(/const STUCK_WINDOW = ([0-9.]+)/.exec(mobileSrc)?.[1]);
    const mobileShare = Number(/covered < ([0-9.]+) \* avg \* this\.stuckClock/.exec(mobileSrc)?.[1]);
    const patience = Math.min(fighterWindow * (1 - fighterShare), mobileWindow * (1 - mobileShare));
    ok(Number.isFinite(patience) && patience > 0.5, `the stuck checks' patience, read off the fighters' and the mobiles' own numbers: ${patience.toFixed(2)} s`);
    const R = 0.35;
    const TOP = 1.6;
    const STEP = 0.5;
    const waitOf = (s: StyleRow, speed: number): number => {
      const b = models.get((s.door ?? s.door2)!);
      if (!b) return 0;
      const mv = s.move;
      let axis = 0;
      for (let k = 1; k < 3; k++) if (Math.abs(mv[k]) > Math.abs(mv[axis])) axis = k;
      const len = Math.abs(mv[axis]);
      if (!(len > 1e-6)) return Infinity;
      const lo = Math.min(b.min[axis], b.max[axis]);
      const hi = Math.max(b.min[axis], b.max[axis]);
      // The share of the slide after which the leaf is out of the body's way.
      const [blo, bhi] = axis === 1 ? [STEP, TOP] : [-R, R];
      const need = mv[axis] > 0 ? (bhi - lo) / len : (hi - blo) / len;
      let t = 0;
      if (need > 1 + 1e-6) return Infinity;
      if (need > 0) {
        let p0 = 0;
        let p1 = 1;
        for (let i = 0; i < 50; i++) {
          const p = (p0 + p1) / 2;
          if (doorEase(p, s.spring, s.smooth) >= need) p1 = p;
          else p0 = p;
        }
        t = p1 * s.open;
      }
      // The body walks through along the axis across the doorway that the leaf does not slide along.
      const thru = axis === 2 ? 0 : 2;
      const face = Math.max(DOORS_TUNE.minDepth, Math.abs(b.min[thru]), Math.abs(b.max[thru]));
      const arrive = Math.max(0, s.trigger - R - face) / speed;
      return Math.max(0, t - arrive);
    };
    let worstWalk = 0;
    let worstWalkName = '';
    const slowRun: string[] = [];
    const neverClear: string[] = [];
    let worstRunOthers = 0;
    // Measured: the one style a running body waits at longer than the patience, Jabba's palace's inner
    // door, a 3.8 m stone slab that takes four seconds to rise and opens for a body 5 m off (1.21 s).
    const KNOWN_SLOW_RUN = new Set(['door_jabba_insidedoor']);
    for (const [name, s] of styleRows) {
      const walk = waitOf(s, 2);
      const runWait = waitOf(s, 5.5);
      if (!Number.isFinite(walk)) neverClear.push(name);
      if (walk > worstWalk) {
        worstWalk = walk;
        worstWalkName = name;
      }
      if (runWait >= patience) slowRun.push(`${name} ${runWait.toFixed(2)} s`);
      else if (!KNOWN_SLOW_RUN.has(name)) worstRunOthers = Math.max(worstRunOthers, runWait);
    }
    ok(neverClear.length === 0, `every style's leaf clears a body's way once it is open${neverClear.length ? ` (not: ${neverClear.join(', ')})` : ''}`);
    ok(worstWalk < patience, `no style keeps a walking body waiting as long as the stuck checks' patience (worst ${worstWalk.toFixed(2)} s, ${worstWalkName})`);
    ok(slowRun.every((r) => KNOWN_SLOW_RUN.has(r.split(' ')[0])), `a running body waits that long only at the styles named (${slowRun.join('; ') || 'none'}); every other at most ${worstRunOthers.toFixed(2)} s`);
  }
}

console.log(`\n${passed} passed`);
