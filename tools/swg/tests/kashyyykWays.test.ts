// SOE's own ways about Kashyyyk and Mustafar (the map fixes' second wave): the converter's half (`tools/swg/nge.mjs`
// reads the copy's zone lines, dungeons, clone mapping, starports and a template's own objvars; `tools/swg/ngeways.mjs`
// builds the ways; `tools/swg/ngeref.mjs` keeps them in the reference, held to the copy by the people's own check), the
// game's half (`src/world/ngeWays.ts`), the two starports' travel children, a zone of copies' map pictures, and the
// hand-overs only the game makes, pinned as text.
//
// **Nothing of the copy is in this file.** The tree it reads is written into the system's temporary folder at run time
// from the literals below, every name in it `test_*` (a self-check reads back every file written and fails the run if
// one is not), shaped as the copy is shaped, since the shape of a table is format knowledge and its rows are not ours to
// quote. Where it reads the committed reference (`tools/swg/ngeref/`), it prints counts and quotes nothing.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeNgeReader, templateOwn } from '../nge.mjs';
import { buildNgeOverlay, kindOf } from '../ngepack.mjs';
import { CLONE_DROID, WAY_ZONES, buildNgeWays, childCellsFor, lineLevel, ngePortsUnstood, parseLine, wayFields, waysPortChildren } from '../ngeways.mjs';
import { NGE_REF_DIR, comparable, ngeRefReader, writeNgeReference } from '../ngeref.mjs';
import { differs } from '../core3ref.mjs';
import { kindOfChild, modelOfKind, placeChildren } from '../travel.mjs';
import { instanceFramesOf } from '../mapframe.mjs';
import { TABLE_PORTS, autoCenter, portKindListed, portKindOf, portsWithoutRow } from '../places.mjs';
import { WAYS_TUNE, areaAt, cloneFor, copyStart, copyStartAt, copyWayOut, gateLanding, guideAt, launcherAt, liftAt, liftLevelWords, moveWords, toGame, toRaw, tuneWays, wayAt, wayFloorAt, type WaysFile } from '../../../src/world/ngeWays.ts';
import { gatesInWorld } from '../../../src/world/zoneGates.ts';
import { portArrivesHome } from '../../../src/world/arrival.ts';
import { PLANETS } from '../../../src/data/planets.ts';
import { attachBitmap, bitmapFiles, parseLayerFile, parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { yawOf } from './terrainAudit.ts';
import { copyIndex } from '../../../src/world/instances.ts';
import { PROMPT_WORDS, fillActions, newPromptState, type PromptAction } from '../../../src/ui/promptRules.ts';
import { mapCopyAt, mapCopyPicture, mapMeta, mapPictureNow } from '../../../src/ui/mapImages.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (p: string): string => readFileSync(join(REPO, p), 'utf8');
/** A method's text, from its signature to the brace that closes it at the signature's own indent (either line ending). */
function methodOf(text: string, sig: string): string {
  const at = text.indexOf(sig);
  if (at < 0) return '';
  const indent = sig.match(/^\s*/)?.[0] ?? '';
  const end = new RegExp(`\\r?\\n${indent}\\}\\r?\\n`, 'g');
  end.lastIndex = at;
  const hit = end.exec(text);
  return text.slice(at, hit ? hit.index : undefined);
}

// ------------------------------------------------------------------------------------------- the tree

/** A table's text: a row of columns, a row of types, then the rows, tab-separated as the copy writes them. */
function tab(columns: string[], types: string[], rows: (string | number)[][]): string {
  return [columns.join('\t'), types.join('\t'), ...rows.map((r) => r.map(String).join('\t'))].join('\r\n') + '\r\n';
}
/** Objvars as a buildout row writes them: name, type, value, ended by `$`. */
function objvars(pairs: [string, string | number][]): string {
  return pairs.length ? `${pairs.map(([k, v]) => `${k}|${typeof v === 'number' ? (Number.isInteger(v) ? 0 : 2) : 4}|${v}`).join('|')}|$|` : '';
}
const COLS = ['objid', 'container', 'server_template_crc', 'cell_index', 'px', 'py', 'pz', 'qw', 'qx', 'qy', 'qz', 'scripts', 'objvars'];
const TYPES = ['i', 'i', 'h', 'i', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 's', 'p'];
const row = (objid: number, template: string, p: number[], scripts: string, ov: [string, string | number][]): (string | number)[] => [objid, 0, template, 0, p[0], p[1], p[2], 1, 0, 0, 0, scripts, objvars(ov)];
const AREA = 'object/tangible/ground_spawning/area_spawner.iff';
const DOOR = 'object/tangible/door/test_zonegate_door.iff';
const LINE = 'systems.movement.zone_transition';
const CELEB = 'npc.celebrity.celebrity_spawner';
const droid = (objid: number, p: number[]) => row(objid, AREA, p, 'systems.spawning.spawner_area', [['strSpawns', CLONE_DROID], ['intSpawnCount', 1], ['fltRadius', 0.0001], ['intDefaultBehavior', 1]]);
/** A clone droid's spawner standing in a building's room (its row in a cell, as Mustafar's are): never a droid the dead come round at. */
const droidInRoom = (objid: number, p: number[]) => {
  const r = droid(objid, p);
  r[3] = 1;
  return r;
};

const AREAS = ['area', 'x1', 'z1', 'x2', 'z2', 'eventRequired'];
const AREA_TYPES = ['s', 'f', 'f', 'f', 'f', 's'];
/** The grid zone's copies, in the table's order: two camps, two trails of two levels each, two pits. */
const GRID = [
  ['test_camp', 2000, 2000, 2500, 2500],
  ['test_camp', 3000, 2000, 3500, 2500],
  ['test_trail_a', 2000, 3000, 2400, 3400],
  ['test_trail_b', 2400, 3000, 2600, 3300],
  ['test_trail_a', 3000, 3000, 3400, 3400],
  ['test_trail_b', 3400, 3000, 3600, 3300],
  ['test_pit', 5000, 5000, 5200, 5200],
  ['test_pit', 5300, 5000, 5500, 5200],
] as const;

function writeTree(root: string): void {
  const game = join(root, 'dsrc', 'sku.0', 'sys.server', 'compiled', 'game');
  const server = join(game, 'datatables');
  const shared = join(root, 'dsrc', 'sku.0', 'sys.shared', 'compiled', 'game', 'datatables');
  const put = (base: string, rel: string, text: string): void => {
    const p = join(base, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, 'latin1');
  };
  put(shared, 'buildout/areas_test_main.tab', tab(AREAS, AREA_TYPES, [['test_main', 0, 0, 1000, 1000, '']]));
  put(shared, 'buildout/areas_test_far.tab', tab(AREAS, AREA_TYPES, [['test_far', -1000, -1000, 0, 0, '']]));
  put(shared, 'buildout/areas_test_grid.tab', tab(AREAS, AREA_TYPES, [...GRID.map((g) => [...g, '']), ['test_event_area', 0, 0, 10, 10, 'test_event']]));
  put(server, 'buildout/test_main/test_main.tab', tab(COLS, TYPES, [
    // A door with a zone line to another zone, one with a line into an instance, and a dungeon's own gate.
    row(101, DOOR, [100, 10, 100], LINE, [['zoneLine', 'test_main_far']]),
    row(102, DOOR, [200, 10, 100], LINE, [['zoneLine', 'test_main_trail']]),
    row(103, DOOR, [300, 10, 100], 'theme_park.dungeon.test_camp_run.test_entry_gate', []),
    // A launcher: a person standing in one place whose objvars name the dungeon a group is sent to.
    row(104, 'object/tangible/spawning/ep3/quest_npc/test_launcher_spawner.iff', [400, 10, 100], CELEB, [['spawns', 'test_launcher_npc'], ['space_dungeon.ticket.dungeon', 'test_pit_run']]),
    // A tree lift: two doors, each with a line to the other's level in this same zone.
    row(105, 'object/building/test_folder/test_lift_door.iff', [510, 10, 500], LINE, [['zoneLine', 'test_lift_high']]),
    row(106, 'object/building/test_folder/test_lift_door.iff', [512, 50, 503], LINE, [['zoneLine', 'test_lift_low']]),
    droid(107, [600, 10, 600]),
    // A starport's own building.
    row(108, 'object/building/test_folder/test_port.iff', [700, 0, 700], 'structure.municipal.starport', []),
    // A row of nothing but its template: a person, whose template's own objvars say who; and a building's, which stays a building.
    row(109, 'object/tangible/spawning/test_folder/test_guide_spawner.iff', [800, 10, 800], '', []),
    row(110, 'object/building/test_folder/test_crew_hall.iff', [850, 0, 850], '', []),
    // A launcher into a dungeon nobody can leave: never a way in.
    row(111, 'object/tangible/spawning/ep3/quest_npc/test_launcher_spawner.iff', [450, 10, 100], CELEB, [['spawns', 'test_launcher_npc'], ['space_dungeon.ticket.dungeon', 'test_noexit_run']]),
    // A row of that person's template that writes objvars of its own and no scripts: it keeps its own, never its template's.
    row(112, 'object/tangible/spawning/test_folder/test_guide_spawner.iff', [820, 10, 820], '', [['spawns', 'test_launcher_npc']]),
  ]));
  put(server, 'buildout/test_grid/test_camp.tab', tab(COLS, TYPES, [
    row(201, 'object/tangible/spawning/test_folder/test_camp_control.iff', [100, 5, 100], 'theme_park.dungeon.space_dungeon_controller', [['space_dungeon.name', 'test_camp_run']]),
    row(202, DOOR, [50, 5, 10], 'theme_park.dungeon.test_camp_pkg.exit_terminal', []),
    droid(203, [60, 5, 20]),
    droidInRoom(204, [70, 5, 30]),
    // A door with a line out of the zone in another area than the trail's: the trail's way out is its own area's gate, never this.
    row(205, DOOR, [90, 5, 90], LINE, [['zoneLine', 'test_main_far']]),
  ]));
  put(server, 'buildout/test_grid/test_trail_a.tab', tab(COLS, TYPES, [
    row(301, 'object/tangible/spawning/test_folder/test_trail_control.iff', [100, 20, 100], 'systems.movement.public_instance_setup', [['instance_name', 'test_trail_run']]),
    row(302, DOOR, [80, 20, 100], LINE, [['zoneLine', 'test_trail_home']]),
    droid(303, [90, 20, 110]),
  ]));
  put(server, 'buildout/test_grid/test_trail_b.tab', tab(COLS, TYPES, [row(401, 'object/tangible/spawning/ep3/quest_npc/test_guide_spawner.iff', [50, 30, 50], CELEB, [['spawns', 'test_guide_npc']])]));
  put(server, 'buildout/test_grid/test_pit.tab', tab(COLS, TYPES, [
    row(501, 'object/tangible/spawning/test_folder/test_pit_control.iff', [20, 5, 20], 'theme_park.dungeon.space_dungeon_controller', [['space_dungeon.name', 'test_pit_run']]),
    row(502, 'object/tangible/spawning/test_folder/test_pit_control.iff', [40, 5, 40], 'theme_park.dungeon.space_dungeon_controller', [['space_dungeon.name', 'test_noexit_run']]),
    // A dungeon whose start is a room (a building copy's, `instances.ts`'s): none of the ways'.
    row(503, 'object/tangible/spawning/test_folder/test_pit_control.iff', [60, 5, 60], 'theme_park.dungeon.space_dungeon_controller', [['space_dungeon.name', 'test_cellstart_run']]),
  ]));
  put(server, 'travel/zone_transition.tab', tab(['zoneLine', 'destination', 'notes'], ['s[unique]', 's[tatooine:0:0:0]', 's'], [
    ['test_example', '', ''],
    ['test_main_far', 'test_far:-500:5:-600', ''],
    ['test_main_trail', 'instance:test_trail_run:test_grid:nocell:-10:2:-3', ''],
    ['test_lift_high', 'test_main:505:50:505', ''],
    ['test_lift_low', 'test_main:500:10:500', ''],
    ['test_trail_home', 'test_main:150:10:150', ''],
    ['test_guideOne_test_guideTwo', 'offset:10:1:20', ''],
    ['test_guideTwo_zoneIn', 'offset:-5:0:-5', ''],
    ['test_unused_line', 'test_far:1:1:1', ''],
  ]));
  put(server, 'dungeon/space_dungeon.tab', tab(['dungeon', 'planet', 'dungeon_area', 'start_loc_x', 'start_loc_y', 'start_loc_z', 'start_loc_radius', 'start_cell_name', 'exit_planet', 'exit_loc_x', 'exit_loc_y', 'exit_loc_z', 'exit_loc_radius'], ['s', 's', 's', 'f', 'f', 'f', 'f', 's', 's', 'f', 'f', 'f', 'f'], [
    ['test_camp_run', 'test_grid', 'test_camp', 10, 1, -20, 3, '', 'test_main', 900, 10, 900, 5],
    ['test_pit_run', 'test_grid', 'test_pit', 1, 0, 1, 3, '', 'test_main', 400, 10, 110, 5],
    ['test_ghost_run', 'test_grid', 'test_ghost', 0, 0, 0, 0, '', 'test_main', 0, 0, 0, 0],
    ['test_noexit_run', 'test_grid', 'test_pit', 0, 0, 0, 3, '', '', 0, 0, 0, 0],
    ['test_elsewhere_run', 'test_other', 'test_other', 0, 0, 0, 0, '', 'test_main', 0, 0, 0, 0],
    ['test_cellstart_run', 'test_grid', 'test_pit', 0, 0, 0, 3, 'test_room_r1', 'test_main', 1, 1, 1, 5],
  ]));
  put(server, 'cloning/clone_mapping.tab', tab(['scene', 'area', 'clone_scene', 'clone_area', 'restrict_bind_facility'], ['s', 's', 's', 's', 'i[0]'], [
    ['test_main', '', 'test_main', '', ''],
    ['test_grid', 'test_camp', 'test_grid', 'test_camp', ''],
    ['test_grid', 'test_camp', 'test_main', '', ''],
    ['test_grid', 'test_pit', 'test_far', '', ''],
    ['test_grid', 'test_trail_b', 'test_grid', 'test_trail_a', ''],
    ['test_far', '', 'test_far', '', ''],
    ['test_far', '', 'test_main', '', ''],
    ['test_other', '', 'test_other', '', ''],
  ]));
  put(server, 'structure/municipal/starport.tab', tab(['STRUCTURE', 'ARRIVAL_X', 'ARRIVAL_Y', 'ARRIVAL_Z', 'ARRIVAL_CELL', 'GROUND_TIME', 'AIR_TIME', 'IS_SHUTTLEPORT', 'VERSION', 'OBJECT', 'X', 'Y', 'Z', 'CELL', 'HEADING', 'IS_TERMINAL', 'IS_TRANSPORT', 'IS_PILOT'], ['s', 'f', 'f', 'f', 's', 'i', 'i', 'i', 'i', 's', 'f', 'f', 'f', 's', 'f', 'i', 'i', 'i'], [
    ['object/building/test_folder/test_port.iff', 20, 0, 17, 'WORLD_DELTA', 300, 60, 1, 1, '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', 'object/tangible/terminal/terminal_travel.iff', -3, 0, -17, 'test_room_r1', -90, 1, 0, 0],
    ['', '', '', '', '', '', '', '', '', 'object/creature/npc/theme_park/player_transport.iff', 0, -9, 0, 'WORLD_DELTA', -90, 0, 1, 0],
    ['', '', '', '', '', '', '', '', '', 'object/tangible/travel/ticket_collector/ticket_collector.iff', 1, 0, 10, 'WORLD_DELTA', 315, 0, 0, 1],
    ['object/building/test_folder/test_unplaced_port.iff', 0, 0, 0, 'WORLD_DELTA', 300, 60, 0, 1, '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', 'object/tangible/terminal/terminal_travel.iff', 1, 0, 1, 'WORLD_DELTA', 0, 1, 0, 0],
  ]));
  const ccols = ['creatureName', 'BaseLevel', 'difficultyClass', 'template', 'aggressive', 'invulnerable', 'herd', 'stalker', 'death_blow', 'primary_weapon', 'primary_weapon_speed', 'secondary_weapon', 'socialGroup', 'pvpFaction', 'niche'];
  const ctypes = ['s[required]', 'i[0]', 'e(NORMAL=0,ELITE=1,BOSS=2)[NORMAL]', 's[required]', 'f[0.0]', 'b[0]', 'b[0]', 'b[0]', 'e(no=0,yes=1,instant=2)[no]', 's[unarmed]', 'f[2.0]', 's[none]', 's[required]', 's', 'e(none=0,npc=5,monster=6,herbivore=7,carnivore=8)[monster]'];
  put(server, 'mob/creatures.tab', tab(ccols, ctypes, [
    ['test_launcher_npc', 10, 'NORMAL', 'test_folder/test_launcher_body.iff', 0, 1, 0, 0, 'no', '', '', '', 'test_social', '', 'npc'],
    ['test_guide_npc', 10, 'NORMAL', 'test_folder/test_guide_body.iff', 0, 1, 0, 0, 'no', '', '', '', 'test_social', '', 'npc'],
  ]));
  put(server, 'mob/stat_balance.tab', tab(['Level', 'HP', 'damagePerSecond', 'Elite_HP', 'Elite_damagePerSecond', 'Boss_HP', 'Boss_damagePerSecond'], ['i', 'i', 'f', 'i', 'f', 'i', 'f'], [[1, 100, 5, 300, 10, 1000, 20], [10, 900, 30, 2000, 60, 5000, 100]]));
  put(game, 'object/mobile/test_folder/test_guide_body.tpf', '@base object/mobile/base/test_base.iff\n\nsharedTemplate = "object/mobile/test_folder/shared_test_guide_body.iff"\nobjvars = [ "zoneLine" = "test_guideOne_test_guideTwo", "startingLocation" = "test_guideTwo_zoneIn", "test_note" = "test_not_a_line" ]\n');
  put(game, 'object/tangible/spawning/test_folder/test_guide_spawner.tpf', '@class tangible_object_template 0\n\tobjvars = [ "spawns" = "test_guide_npc", "npc_name" = "" ]\n\tscripts = [ "npc.celebrity.celebrity_spawner" ]\n');
  put(game, 'object/building/test_folder/test_crew_hall.tpf', '@class building_object_template 0\n\tobjvars = [ "spawn_table" = "datatables/spawning/dungeon/test_none.iff" ]\n\tscripts = [ "theme_park.dungeon.generic_spawner" ]\n');
}

const root = mkdtempSync(join(tmpdir(), 'test_ways_tree_'));
writeTree(root);

// Every name the tree carries begins `test_`, beside the format's own words: the folders and file kinds, the generic
// scripts and templates a row's kind and a way are told by, the objvar names, the travel children's kinds, the
// enumerations' words and the clone droid's creature (`CLONE_DROID`, which the ways look a spawner up by).
{
  const FORMAT = new Set([
    'dsrc', 'sku', 'sys', 'server', 'shared', 'compiled', 'game', 'datatables', 'buildout', 'tab', 'tpf', 'iff', 'mob', 'creatures', 'stat_balance', 'travel', 'zone_transition', 'dungeon', 'space_dungeon', 'cloning', 'clone_mapping', 'structure', 'municipal', 'starport',
    'object', 'tangible', 'mobile', 'building', 'base', 'sharedtemplate', 'ep3', 'quest_npc', 'door', 'ground_spawning', 'area_spawner', 'spawning', 'terminal', 'terminal_travel', 'creature', 'npc', 'theme_park', 'player_transport', 'ticket_collector', 'world_delta',
    'systems', 'movement', 'spawner_area', 'celebrity', 'celebrity_spawner', 'space_dungeon_controller', 'exit_terminal', 'public_instance_setup', 'generic_spawner', 'class', 'tangible_object_template', 'building_object_template',
    'zoneline', 'startinglocation', 'spawns', 'npc_name', 'spawn_table', 'strspawns', 'intspawncount', 'fltradius', 'intdefaultbehavior', 'instance_name', 'name', 'ticket', 'objvars', 'scripts', 'offset', 'instance', 'nocell',
    'normal', 'no', CLONE_DROID,
  ]);
  const word = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\b/g;
  const stray = new Set<string>();
  const read = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        read(p);
        continue;
      }
      const lines = readFileSync(p, 'latin1').split(/\r?\n/);
      for (const t of [relative(root, p), ...(p.endsWith('.tab') ? lines.slice(2) : lines)]) {
        for (const m of t.toLowerCase().matchAll(word)) {
          const n = m[1].replace(/^(shared|areas)_/, '');
          if (!n.startsWith('test_') && !FORMAT.has(n) && !/^\d/.test(n)) stray.add(m[1]);
        }
      }
    }
  };
  read(root);
  ok(stray.size === 0, `every name the tree carries begins test_${stray.size ? `: ${[...stray].join(', ')}` : ''}`);
}

// ------------------------------------------------------------------------------------------ reading
{
  const reader = makeNgeReader(root)!;
  const lines = reader.zoneLines();
  ok(lines.get('test_main_far') === 'test_far:-500:5:-600' && !lines.has('test_example') && lines.size === 8, `the zone lines are read by name, a line naming no destination left out (${lines.size})`);
  ok(JSON.stringify(parseLine('test_far:-500:5:-600')) === JSON.stringify({ zone: 'test_far', at: [-500, 5, -600] }) && parseLine('offset:10:1:20')?.offset?.[2] === 20 && parseLine('instance:test_trail_run:test_grid:nocell:-10:2:-3')?.cell === '' && parseLine('instance:test_a:test_b:test_room:1:2:3')?.cell === 'test_room' && parseLine('test_nonsense') === null, 'a line is a place in a zone, an instance (a room or none), or an offset; anything else none');
  ok(lineLevel('test_guideOne_test_guideTwo') === 2 && lineLevel('test_guideTwo_zoneIn') === 0 && lineLevel('test_guideGate_test_guideFive') === 5 && lineLevel('test_nothing') === -1, "a trail move's level is the last of its two places, nought back to the gate");
  const trail = reader.buildout('test_main', 'test_main')!;
  const filled = trail.find((r) => r.server_template_crc.endsWith('test_guide_spawner.iff'))!;
  const hall = trail.find((r) => r.server_template_crc.endsWith('test_crew_hall.iff'))!;
  ok(filled.objvars.get('spawns')?.value === 'test_guide_npc' && filled.scripts.includes('npc.celebrity.celebrity_spawner') && kindOf(filled.server_template_crc, filled.scripts, filled.objvars) === 'static', "a row of nothing but its template takes its template's own objvars and scripts where the template is a person standing in one place");
  ok(hall.objvars.size === 0 && hall.scripts.length === 0 && kindOf(hall.server_template_crc, hall.scripts, hall.objvars) === 'other', "and a building's template that names a crew is left as it was: its crew is not read in through it");
  const own = templateOwn('objvars = +[ "test_a" = "test_b", "test_c" = "" ]\nscripts = +[ "test_d", "test_e" ]');
  ok(own.vars.get('test_a')?.value === 'test_b' && own.vars.get('test_c')?.value === '' && own.scripts.join(',') === 'test_d,test_e', "a template's own objvars and scripts are its two brackets, read as names and texts");
  const ownRow = trail.find((r) => Number(r.px) === 820)!;
  ok(ownRow.objvars.get('spawns')?.value === 'test_launcher_npc' && ownRow.objvars.size === 1 && ownRow.scripts.length === 0, "a row of a person's template that writes objvars of its own keeps them, and takes none of its template's");
  ok(reader.spaceDungeons().length === 6 && reader.cloneMapping().length === 8 && reader.starports().get('object/building/test_folder/test_port.iff')?.children.length === 3, 'the dungeons, the clone mapping and the starports are read as the tables write them');
  ok(JSON.stringify(reader.templateLines('test_folder/test_guide_body.iff', (n: string) => lines.has(n))) === JSON.stringify([['zoneLine', 'test_guideOne_test_guideTwo'], ['startingLocation', 'test_guideTwo_zoneIn']]), "a guide's template names its two lines, and an objvar that names no line is left out");
  const wf = wayFields({ objvars: new Map(), scripts: ['theme_park.dungeon.test_camp_run.test_entry_gate', 'theme_park.dungeon.test_x.exit_terminal', 'structure.municipal.starport'] });
  ok(wf?.gate === 'test_camp_run' && wf.exit === 1 && wf.port === 1 && Object.keys(wf).length === 3 && wayFields({ objvars: new Map(), scripts: ['systems.spawning.spawner_area'] }) === null, "a way is told by its objvars and the shape of its scripts' names: a gate's dungeon, an exit, a starport");
}

// The packs and the catalogue a converter would hand over: the ways need no layout of their own.
const pack = { layout: { objects: [] }, manifest: { categories: { layout: [] } }, stamp: 'test_stamp' };
const catalogue = { converted: 'test_converted', entries: [] as unknown[] };
const zones = ['test_main', 'test_grid', 'test_far'];
const buildWith = (reader: ReturnType<typeof makeNgeReader>, archives: boolean) => buildNgeOverlay({ reader, zones, packOf: () => pack, groundOf: () => () => Number.NaN, snapOf: null, clientAreas: archives ? (z: string) => (makeNgeReader(root)!.areas(z) ?? []).map((a: Record<string, unknown>) => ({ ...a, x1: Number(a.x1), z1: Number(a.z1), x2: Number(a.x2), z2: Number(a.z2) })) : null, catalogue, converted: 'test_now', wayZones: zones });
const live = buildWith(makeNgeReader(root)!, false);
const w = live.ways as unknown as WaysFile & { ports: Record<string, { children: unknown[] }>; counts: Record<string, number> };

// ------------------------------------------------------------------------------------- the ways built
{
  const main = w.zones.test_main;
  const at = (g: { at: readonly number[] }) => g.at.join(',');
  ok(main.gates.some((g) => at(g) === '100,10,100' && 'zone' in g.to && g.to.zone === 'test_far' && g.to.at.join(',') === '-500,5,-600'), "a door's line out of its zone is a gate landing at the line's own place");
  ok(main.gates.some((g) => at(g) === '200,10,100' && 'dungeon' in g.to && g.to.dungeon === 'test_trail_run') && main.gates.some((g) => at(g) === '300,10,100' && 'dungeon' in g.to && g.to.dungeon === 'test_camp_run'), "a line into an instance with no room, and a dungeon's own gate, are gates into a copy");
  ok(main.launchers.length === 1 && main.launchers[0].dungeon === 'test_pit_run' && at(main.launchers[0]) === '400,10,100', 'a person whose objvars name a dungeon is its launcher, and one into a dungeon nobody can leave is none');
  ok(main.lifts.length === 1 && main.lifts[0].doors.length === 2 && main.lifts[0].levels.map((l) => l[1]).join(',') === '10,50', "the doors whose lines stay in their zone are one lift, its levels lowest first");
  ok(main.clones.length === 1 && at(main.clones[0]) === '600,10,600' && main.clones[0].area === 'test_main', "an area spawner standing the clone droid is the zone's clone droid");
  const guide = main.guides.find((g) => g.who === 'test_guide_npc')!;
  ok(guide && at(guide) === '800,10,800' && guide.moves.map((m) => `${m.key}:${m.level}:${m.to.join(',')}`).join(' ') === 'zoneLine:2:810,11,820 startingLocation:0:795,10,795', "a guide's moves are its place and each line's offset, never turned, the guide stood through its template alone included");
  const grid = w.zones.test_grid;
  ok(grid.areas.length === 8 && grid.areas[1].join(',') === 'test_camp,3000,2000,3500,2500', "a zone's areas are every copy, in the table's order, an event's left out");
  const camp = w.dungeons.test_camp_run;
  ok(camp && camp.starts.map((s) => s.join(',')).join(' ') === '2110,6,2080 3110,6,2080' && camp.exit?.zone === 'test_main' && camp.exit.at.join(',') === '900,10,900' && !camp.walkOut, "a space dungeon starts at each copy's corner plus its controller plus its own start, and leaves by its own exit");
  const trailRun = w.dungeons.test_trail_run;
  ok(trailRun && trailRun.starts.map((s) => s.join(',')).join(' ') === '2090,22,3097 3090,22,3097' && trailRun.exit?.zone === 'test_main' && trailRun.exit.at.join(',') === '150,10,150' && trailRun.area === 'test_trail_a', "an instance with no room starts at each copy's controller plus its line's offset, and leaves by its gate's line");
  ok(w.dungeons.test_pit_run?.walkOut === true && !('test_ghost_run' in w.dungeons) && !('test_elsewhere_run' in w.dungeons) && !('test_noexit_run' in w.dungeons), 'a copy with no gate of its own is left where it is come into, and a dungeon with no controller stood, or no way out, is no dungeon');
  ok(!('test_cellstart_run' in w.dungeons), "a dungeon whose start is a room is a building copy's (`instances.ts`), none of the ways'");
  ok(grid.gates.filter((g) => 'zone' in g.to && g.to.zone === 'test_main' && g.to.at.join(',') === '900,10,900').map(at).join(' ') === '2050,5,2010 3050,5,2010', "each copy's exit is a gate out to its dungeon's exit");
  ok(grid.clones.map((c) => `${c.area}:${c.copy}`).join(' ') === 'test_camp:0 test_camp:1 test_trail_a:0 test_trail_a:1', 'each copy has its own clone droid, by area and copy');
  ok(!grid.clones.some((c) => c.at.join(',') === '2070,5,2030' || c.at.join(',') === '3070,5,2030'), "a clone droid's spawner standing in a building's room is no droid the dead come round at (Mustafar's are all such, and Mustafar keeps its deck)");
  ok(w.clone.length === 7 && !w.clone.some((r) => r[0] === 'test_other'), "the clone mapping's rows for these zones, in the table's order");
  ok(Object.keys(w.ports).join(',') === 'object/building/test_folder/test_port.iff' && w.ports['object/building/test_folder/test_port.iff'].children.length === 3, 'the starports these zones place, and no other');
  ok((w.ports['object/building/test_folder/test_port.iff'] as unknown as { shuttleport: boolean }).shuttleport === true, 'each as the table says it is, a shuttleport kept one');
  ok(w.counts.lost === 1 && w.counts.dungeons === 3 && w.counts.copies === 6 && w.counts.droids === 5, `the counts say what was built (${JSON.stringify(w.counts)})`);
}

// ------------------------------------------------------------------------------------- the reference
// Written from the tree, read back through the reader every converter uses, and built into the very ways the tree
// builds, by the people's own check (`comparable`): with the client's areas and without.
{
  const refDir = join(mkdtempSync(join(tmpdir(), 'test_ways_ref_')), 'test_ngeref');
  const written = writeNgeReference({ reader: makeNgeReader(root)!, fresh: makeNgeReader(root)!, build: buildWith, modes: [true, false], zones, wayZones: zones, outDir: refDir, made: 'test_now' });
  for (const archives of [true, false]) {
    const fromCopy = buildWith(makeNgeReader(root)!, archives);
    const fromRef = buildWith(ngeRefReader(refDir)!, archives);
    const d = differs(comparable(fromCopy), comparable(fromRef));
    ok(d === null && JSON.stringify(fromRef.ways.zones) === JSON.stringify(fromCopy.ways.zones) && JSON.stringify(fromRef.ways.dungeons) === JSON.stringify(fromCopy.ways.dungeons) && JSON.stringify(fromRef.ways.ports) === JSON.stringify(fromCopy.ways.ports), `${archives ? 'with the client areas' : 'without'}, the ways built from the reference are the ways built from the copy${d ? `: ${d}` : ''}`);
  }
  ok(comparable(live).ways !== null && (comparable(live).ways as { zones?: unknown }).zones !== undefined, 'and the check compares the ways, not only the people');
  const tables = JSON.parse(readFileSync(join(refDir, 'tables.json'), 'utf8'));
  ok(!('test_unused_line' in tables.lines) && 'test_guideOne_test_guideTwo' in tables.lines && tables.dungeons.length === 5 && tables.clone.length === 7 && Object.keys(tables.ports).length === 1, 'the reference keeps the lines something names, the dungeons, clone rows and starports of these zones, and no other');
  const text = readdirSync(refDir).map((f) => readFileSync(join(refDir, f), 'utf8')).join('\n');
  ok(!/theme_park\.dungeon|structure\.municipal|npc\.celebrity|systems\.movement/.test(text), 'and never a script: what a way is, read off its scripts, is kept as a name and a flag');
  // A reference that loses a way's line builds other ways, and the check says so.
  const lost = join(dirname(refDir), 'test_lost');
  mkdirSync(lost, { recursive: true });
  for (const f of readdirSync(refDir)) writeFileSync(join(lost, f), readFileSync(join(refDir, f)));
  const t2 = JSON.parse(readFileSync(join(lost, 'tables.json'), 'utf8'));
  delete t2.lines.test_main_far;
  writeFileSync(join(lost, 'tables.json'), JSON.stringify(t2));
  ok(differs(comparable(buildWith(makeNgeReader(root)!, false)), comparable(buildWith(ngeRefReader(lost)!, false))) !== null, "a reference missing one line would land a gate otherwise, and the check finds it");
  // And a guide body's objvar that names no line, written into a reference by a hand other than the writer's, is still no move.
  const junk = join(dirname(refDir), 'test_junk');
  mkdirSync(junk, { recursive: true });
  for (const f of readdirSync(refDir)) writeFileSync(join(junk, f), readFileSync(join(refDir, f)));
  const t3 = JSON.parse(readFileSync(join(junk, 'tables.json'), 'utf8'));
  const bodyKey = Object.keys(t3.templateLines)[0];
  t3.templateLines[bodyKey].push(['test_note', 'test_not_a_line']);
  writeFileSync(join(junk, 'tables.json'), JSON.stringify(t3));
  const isLine = (n: string): boolean => n in t3.lines;
  ok(Object.keys(t3.templateLines).length === 1 && JSON.stringify(ngeRefReader(junk)!.templateLines('test_folder/test_guide_body.iff', isLine)) === JSON.stringify([['zoneLine', 'test_guideOne_test_guideTwo'], ['startingLocation', 'test_guideTwo_zoneIn']]), "the reference's reader answers a guide body's lines and nothing else it holds");
  ok(written.index.counts.tables.lines === 7 && written.index.counts.tables.ports === 1, `the index counts the ways' tables (${JSON.stringify(written.index.counts.tables)})`);
  rmSync(dirname(refDir), { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------- the game's half
{
  const zone = w.zones.test_main;
  ok(JSON.stringify(gateLanding(w, 'test_main', 101, 101)) === JSON.stringify({ zone: 'test_far', at: [-500, 5, -600] }) && gateLanding(w, 'test_main', 100 + WAYS_TUNE.gateMatch + 1, 100) === null, "a gate takes the landing of SOE's door within reach of it, and none farther");
  ok(JSON.stringify(gateLanding(w, 'test_main', 401, 100)) === JSON.stringify({ dungeon: 'test_pit_run' }), 'a launcher standing at a gate is that gate\'s way in');
  // A name whose copy is the second, so a rule that sent everybody to the first would be seen.
  const id = 'test_group_b';
  const start = copyStart(w, 'test_camp_run', id)!;
  ok(start.copy === copyIndex(id, 'test_camp_run', 2) && start.copy === 1 && start.at.join(',') === '3110,6,2080', "a group is sent to the copy the dungeons' own hash picks, at that copy's start");
  // And a name the hash sends to the first copy, so a rule that sent everybody to the second would be seen too.
  const other = ['test_group_a', 'test_group_c', 'test_group_d', 'test_group_e', 'test_group_f'].find((n) => copyIndex(n, 'test_camp_run', 2) === 0)!;
  ok(!!other && copyStart(w, 'test_camp_run', other)!.copy === 0 && copyStart(w, 'test_camp_run', other)!.at.join(',') === '2110,6,2080' && copyStart(w, 'test_nothing', id) === null, "another group to the other copy by the same hash, and no copy of a dungeon the ways do not know");
  const lift = liftAt(w, 'test_main', 511, 11, 501)!;
  ok(lift && lift.levels.length === 2 && lift.current === 0 && liftAt(w, 'test_main', 512, 50, 503)!.current === 1 && liftAt(w, 'test_main', 512, 30, 503) === null, "a lift door within reach offers the lift's levels, the one it stands on marked; a door on another level is not this one");
  ok(liftLevelWords(0) === 'the ground' && liftLevelWords(2) === 'level 2' && moveWords({ key: 'zoneLine', level: 3 }) === "the trail's level 3" && moveWords({ key: 'startingLocation', level: 0 }) === 'back to the trail gate', 'the words are ours');
  ok(guideAt(w, 'test_main', 801, 10, 801)?.moves.length === 2 && guideAt(w, 'test_main', 801, 10, 801 + WAYS_TUNE.reach + 1) === null, 'a guide within reach offers its moves');
  ok(launcherAt(w, 'test_main', 401, 10, 101)?.dungeon === 'test_pit_run', 'a launcher within reach is a way into its copy');
  const pit = w.dungeons.test_pit_run.starts[1];
  ok(copyWayOut(w, 'test_grid', pit[0] + 1, pit[1], pit[2])?.exit.at.join(',') === '400,10,110' && copyWayOut(w, 'test_grid', ...(w.dungeons.test_camp_run.starts[0] as [number, number, number])) === null, "a copy with no gate of its own is left at its start, by its dungeon's exit; a copy with a gate is left by the gate");
  // Which way the use key takes, in the one order the key and the bar read (`wayAt`, which `gatherWay` asks): a copy's way
  // out, then a guide, then a launcher, where all three stand within reach of one spot; and a way that leaves where the
  // player stands stands aside while `leave` is false (a blow within the gates' calm, somebody to be got up), the guide not.
  const mixed = {
    format: 1,
    zones: { test_z: { areas: [], gates: [], lifts: [], guides: [{ at: [0, 0, 3], who: 'test_guide', area: 'test_z', copy: 0, moves: [{ key: 'zoneLine', level: 2, to: [9, 0, 9] }] }], launchers: [{ at: [1, 0, 0], dungeon: 'test_run', who: 'test_launcher' }, { at: [40, 0, 0], dungeon: 'test_run', who: 'test_launcher' }, { at: [0, 0, 8], dungeon: 'test_run', who: 'test_launcher' }], clones: [] } },
    dungeons: { test_run: { zone: 'test_z', area: 'test_a', starts: [[0, 0, 0]], exit: { zone: 'test_far', at: [7, 7, 7] }, walkOut: true } },
    clone: [],
  } as unknown as WaysFile;
  const w0 = wayAt(mixed, 'test_z', 0, 0, 0, true);
  ok(w0?.kind === 'out' && w0.exit.zone === 'test_far' && wayAt(mixed, 'test_z', 0, 0, 0, false)?.kind === 'guide', "at a copy's start with a guide and a launcher beside it the use key leaves by the way out, and while it may not leave, opens the guide");
  ok(wayAt(mixed, 'test_z', 1, 0, 1.5, true)?.kind === 'out' && wayAt(mixed, 'test_z', 40, 0, 1, true)?.kind === 'in' && wayAt(mixed, 'test_z', 40, 0, 1, false) === null, 'a launcher alone takes the group in, and stands aside while it may not leave');
  // Out of the start's reach, within a guide's and a launcher's both.
  const gw = wayAt(mixed, 'test_z', 0, 0, 6.5, true);
  ok(gw?.kind === 'guide' && gw.guide.who === 'test_guide' && wayAt(mixed, 'test_z', 500, 0, 500, true) === null && wayAt(null, 'test_z', 0, 0, 0, true) === null, 'a guide before a launcher, and nothing out of reach of every way');
  ok(wayAt(w, 'test_main', 401, 10, 101, true)?.kind === 'in' && (wayAt(w, 'test_main', 401, 10, 101, true) as { dungeon: string }).dungeon === 'test_pit_run', 'the ways built take a launcher of theirs the same way');
  ok(copyWayOut(mixed, 'test_z', 0, 10, 0) === null && copyWayOut(mixed, 'test_z', 0, 1, 0)?.dungeon === 'test_run', "a copy's way out is its start at its own height: a walkway 10 m over it is not there");
  // A gate or a launcher into a dungeon the ways do not know is no way at all, and of a zone's droids the nearest is the one.
  const loose = {
    format: 1,
    zones: { test_z: { areas: [], gates: [{ at: [0, 0, 0], to: { dungeon: 'test_gone' } }], lifts: [], guides: [], launchers: [{ at: [100, 0, 0], dungeon: 'test_gone', who: 'test_launcher' }], clones: [{ at: [500, 0, 0], area: 'test_z', copy: 0 }, { at: [-500, 0, 0], area: 'test_z', copy: 0 }] } },
    dungeons: {},
    clone: [['test_z', '', 'test_z', '']],
  } as unknown as WaysFile;
  ok(gateLanding(loose, 'test_z', 0, 0) === null && gateLanding(loose, 'test_z', 100, 0) === null && launcherAt(loose, 'test_z', 100, 0, 0) === null, 'a gate or a launcher into a dungeon the ways do not know is no way in');
  ok(cloneFor(loose, 'test_z', -400, 0)?.at[0] === -500 && cloneFor(loose, 'test_z', 400, 0)?.at[0] === 500, "a death comes round at the nearest of its own zone's droids");
  // The copy a death or a reload in a grid zone comes back at (`copyStartAt`): its own dungeon's start, by area and copy.
  ok(copyStartAt(w, 'test_grid', 3100, 2100)?.at.join(',') === '3110,6,2080' && copyStartAt(w, 'test_grid', 2100, 2100)?.at.join(',') === '2110,6,2080' && copyStartAt(w, 'test_grid', 5350, 5100)?.dungeon === 'test_pit_run' && copyStartAt(w, 'test_main', 10, 10) === null && copyStartAt(w, 'test_grid', 9000, 9000) === null, "a point in a copy comes back at that copy's own start, and outside every copy at none");
  ok(copyStartAt(w, 'test_grid', 3500, 3100) === null, 'an area no dungeon of its own names, in a zone of several dungeons, is none of theirs');
  const oneRun = {
    format: 1,
    zones: { test_t: { areas: [['test_l1', 0, 0, 100, 100], ['test_l2', 100, 0, 150, 50], ['test_l1', 1000, 0, 1100, 100], ['test_l2', 1100, 0, 1150, 50]], gates: [], lifts: [], guides: [], launchers: [], clones: [] } },
    dungeons: { test_t_run: { zone: 'test_t', area: 'test_l1', starts: [[5, 1, 5], [1005, 1, 5]], exit: { zone: 'test_far', at: [0, 0, 0] } } },
    clone: [],
  } as unknown as WaysFile;
  ok(copyStartAt(oneRun, 'test_t', 1120, 20)?.at.join(',') === '1005,1,5' && copyStartAt(oneRun, 'test_t', 120, 20)?.copy === 0, "in a zone of one dungeon (the Rryatt Trail), a later level's copy comes back at that dungeon's start in the same copy");
  const nested = { areas: [['test_big', 0, 0, 100, 100], ['test_small', 10, 10, 20, 20], ['test_small', 40, 40, 50, 50]] as [string, number, number, number, number][], gates: [], lifts: [], guides: [], launchers: [], clones: [] };
  ok(JSON.stringify(areaAt(zone, 10, 10)) === JSON.stringify({ area: 'test_main', copy: 0 }) && JSON.stringify(areaAt(w.zones.test_grid, 3500, 3100)) === JSON.stringify({ area: 'test_trail_b', copy: 1 }) && JSON.stringify(areaAt(nested, 45, 45)) === JSON.stringify({ area: 'test_small', copy: 1 }) && areaAt(w.zones.test_grid, 9000, 9000) === null, 'which copy a point stands in is the smallest area holding it, and its place among the areas of its name');
  // The clone mapping: the droid of the same copy, the zone's own, a fall through a zone with none to the next, and none.
  ok(cloneFor(w, 'test_grid', 3100, 2100)?.at.join(',') === '3060,5,2020', "a death in a camp's copy comes round at that copy's droid");
  ok(cloneFor(w, 'test_grid', 3500, 3100)?.at.join(',') === '3090,20,3110', "one on a trail's second level comes round at its first level's droid, in the same copy");
  ok(cloneFor(w, 'test_grid', 5100, 5100)?.zone === 'test_main', "one in a pit, whose dead go to a zone with no droid, falls through to that zone's own rows and comes round at the next zone's droid");
  ok(cloneFor(w, 'test_main', 10, 10)?.at.join(',') === '600,10,600' && cloneFor(w, 'test_nowhere', 0, 0) === null, "one in a zone with a droid comes round at it, and a zone the mapping names nothing for comes round at none");
  // The frames and the floor.
  const c = { x: 120, z: -30 };
  const g = toGame([150, 7, 40], c);
  const back = toRaw(g[0], g[1], g[2], c);
  ok(g.join(',') === '-30,7,70' && back.join(',') === '150,7,40', "the snapshot's frame into the game's and back: X mirrored about the layout centre");
  // The tree lift's ground landing is written 0.9 m under the deck it stands on, and the deck 2 to 3 m over the terrain.
  ok(wayFloorAt(157, 30, 157) === 157.05 && wayFloorAt(29, 27.8, 29.9) === 29.95 && wayFloorAt(157, 30, null) === 30.3 && wayFloorAt(29, Number.NaN, null) === 29.3, 'a place of the data is stood on the floor found under it, its own deck when written under it, and on the ground where none is found');
  const was = { ...WAYS_TUNE };
  tuneWays({ reach: 1000, gateMatch: -5, on: false });
  ok(WAYS_TUNE.reach === 50 && WAYS_TUNE.gateMatch === 0.5 && WAYS_TUNE.on === false, 'the tune is clamped');
  Object.assign(WAYS_TUNE, was);
  // The bar: a guide is the instance key's, and says so in its own word.
  ok(PROMPT_WORDS.guide === 'the guide', "a guide is the use key's in its own word");
  const s = newPromptState();
  s.live = true;
  s.instance = 'guide';
  s.talk = true;
  const out: PromptAction[] = Array.from({ length: 4 }, () => ({ action: '', code: '', label: '' }));
  const n = fillActions(s, out);
  ok(n >= 1 && out[0].label === PROMPT_WORDS.guide, 'and the bar offers it before somebody to talk to, as the key takes it');
}

// ------------------------------------------------------------------------------------- the travel children
{
  const kids = waysPortChildren(w.ports, kindOfChild, modelOfKind);
  const port = 'object/building/test_folder/test_port.iff';
  ok(kids.get(port)?.length === 3 && kids.get('object/building/test_folder/shared_test_port.iff') === kids.get(port), 'the starports\' children are keyed by both spellings of the building');
  const placed = [{ template: 'object/building/test_folder/shared_test_port.iff', x: 1000, y: 50, z: 2000, q: [Math.SQRT1_2, 0, Math.SQRT1_2, 0], model: 'test_port_model' }];
  // The building's own shell (cell 0) named as the room is: never the room, whatever its name.
  const cells = childCellsFor(kids, (t: string) => (t === placed[0].template ? [{ index: 0, name: 'test_room_r1' }, { index: 3, name: 'test_room_r1' }] : null));
  const rows = placeChildren(placed, cells.byTemplate);
  const transport = rows.find((r: Record<string, unknown>) => r.kind === 'shuttle')!;
  const collector = rows.find((r: Record<string, unknown>) => r.kind === 'collector')!;
  const terminal = rows.find((r: Record<string, unknown>) => r.kind === 'terminal')!;
  // The server's own arithmetic, `travel.java`: the delta turned by the structure's yaw (x cos + z sin, z cos - x sin) and taken off its place.
  const yaw = Math.PI / 2;
  const server = (dx: number, dy: number, dz: number) => [1000 - (dx * Math.cos(yaw) + dz * Math.sin(yaw)), 50 - dy, 2000 - (dz * Math.cos(yaw) - dx * Math.sin(yaw))];
  const near = (r: Record<string, unknown>, p: number[]) => Math.hypot((r.x as number) - p[0], (r.y as number) - p[1], (r.z as number) - p[2]) < 1e-2;
  ok(near(transport, server(0, -9, 0)) && near(collector, server(1, 0, 10)), `a child the table stands outside is the structure's place less its delta turned by the structure's yaw, as the server stood it (${[transport.x, transport.y, transport.z].join(',')})`);
  ok(Math.abs((collector.yaw as number) - (yaw + (315 * Math.PI) / 180)) < 1e-3 && Math.abs((transport.yaw as number) - (yaw - Math.PI / 2)) < 1e-3, "and faces its own heading added to the structure's");
  ok(terminal.cell === 3 && terminal.x === -3 && terminal.z === -17 && !('cellName' in terminal) && cells.lost === 0, "a child in a named room takes that room's index from the building's own cells, in the building's frame");
  const none = childCellsFor(kids, (t: string) => (t === placed[0].template ? [{ index: 1, name: 'test_room_other' }] : null));
  ok(none.lost === 1 && placeChildren(placed, none.byTemplate).filter((r: Record<string, unknown>) => r.kind === 'terminal').length === 0, "and one whose room the building has not got is left out and counted");
  const portsSet = new Set([port, 'object/building/test_folder/shared_test_port.iff']);
  ok(ngePortsUnstood(placed, [], portsSet) === true && ngePortsUnstood(placed, rows, portsSet) === false && ngePortsUnstood([], [], portsSet) === false && ngePortsUnstood(placed, [], new Set()) === false, "status asks for travel again of a world that places such a starport with no row of its own");
  ok(ngePortsUnstood(placed, [], portsSet, true) === false && ngePortsUnstood(placed, [], portsSet, false) === true, 'and never of one whose travel left them out by choice (--nge=none)');
  ok(ngePortsUnstood([{ ...placed[0], contained: true }], [], portsSet) === false, 'nor of one that places such a building only inside another (a top-level building is what stands the children)');
}

// ------------------------------------------------------------------------------------- the map's copies
{
  const iso = (area: string, x1: number, z1: number, x2: number, z2: number, isolated = 1) => ({ area, x1, z1, x2, z2, allowMap: 1, isolated, compositeX1: 0, compositeZ1: 0, compositeX2: 0, compositeZ2: 0, eventRequired: '' });
  const pics = new Set(['ui_map_test_zone_test_kind_a', 'ui_map_test_zone']);
  const frames = instanceFramesOf({ planet: 'test_zone', areas: [iso('test_kind_a', 0, 0, 1000, 1000), iso('test_kind_b', 2000, 0, 2512, 512), iso('test_kind_c', 4000, 0, 4600, 400)], instanceAreas: [{ area: 'test_zone__test_kind_c', x: 700, z: 400 }], hasPicture: (n: string) => pics.has(n) });
  ok(frames.length === 3 && frames[0].texture === 'texture/ui_map_test_zone_test_kind_a.dds' && frames[1].texture === 'texture/ui_map_test_zone.dds', "a copy wears its kind's own picture, else the zone's");
  ok(frames[2].width === 700 && frames[2].centre.x === 4300 && frames[2].centre.z === 200 && frames[1].width === 512 && frames[0].width === 1000, 'each framed square over its larger side about its middle, the size the instance table gives where it has one');
  // Taller than wide, as the Rryatt Trail's later levels are: the square is over the height, from the area and from the table alike.
  const tall = instanceFramesOf({ planet: 'test_zone', areas: [iso('test_kind_a', 0, 0, 300, 900), iso('test_kind_b', 1000, 0, 1300, 300)], instanceAreas: [{ area: 'test_zone__test_kind_b', x: 400, z: 800 }], hasPicture: () => true });
  ok(tall.length === 2 && tall[0].width === 900 && tall[0].centre.z === 450 && tall[1].width === 800, 'an area taller than it is wide, and an instance row taller than wide, are framed square over their height');
  ok(instanceFramesOf({ planet: 'test_zone', areas: [iso('test_kind_a', 0, 0, 10, 10, 0), iso('test_kind_a', 20, 0, 30, 10, 0)], hasPicture: () => true }).length === 0, "a launch world's tiles are never copies: only isolated areas are");
  ok(instanceFramesOf({ planet: 'test_zone', areas: [iso('test_kind_a', 0, 0, 10, 10)], hasPicture: () => true }).length === 0 && instanceFramesOf({ planet: 'test_zone', areas: [iso('test_kind_a', 0, 0, 10, 10), iso('test_kind_a', 20, 0, 30, 10)], hasPicture: () => false }).length === 0, 'one copy alone is a world of its own, and a copy with no picture is left out');
}

// ------------------------------------------------------------------------------------- the copy's picture, as the game picks it
// The map window and the minimap ask `mapImages.ts` which copy a point of the map's frame stands in and draw that copy's
// own picture over that copy's ground: driven here through the real module, against a stand-in site.
{
  const pack = 'kashyyyk_rryatt_trail';
  const realFetch = globalThis.fetch;
  const g = globalThis as unknown as { createImageBitmap?: unknown };
  const realBitmap = g.createImageBitmap;
  const asked: string[] = [];
  const meta = {
    image: 'map.png',
    width: 8192,
    centre: { x: 0, z: 0 },
    // The small box first, so a rule that took the last box holding a point rather than the smallest would be seen.
    instances: [
      // A copy the file writes wrongly comes first: it is left out, and the copies after it are named by their places
      // among the copies kept, which is how the map window and the minimap ask for their pictures.
      { area: 'test_broken', box: [0, 0, 'x', 1], image: 'map_test_kind_a.png' },
      { area: 'test_kind_a', box: [20, 20, 40, 40], image: 'map_test_kind_a.png', width: 20, centre: { x: 30, z: 30 } },
      { area: 'test_kind_a', box: [0, 0, 100, 100], image: 'map_test_kind_a.png', width: 100, centre: { x: 50, z: 50 } },
      { area: 'test_kind_b', box: [200, 0, 300, 100], image: 'map_test_kind_b.png', width: 120, centre: { x: 250, z: 50 } },
    ],
  };
  globalThis.fetch = (async (url: string | URL) => {
    const path = String(url).replace(/^\/+/, '');
    asked.push(path);
    if (path === `assets-private/${pack}/map.json`) return new Response(JSON.stringify(meta), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\.png$/.test(path)) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }) as typeof fetch;
  let decoded = 0;
  g.createImageBitmap = async () => ({ test_bitmap: ++decoded });
  try {
    ok(mapCopyAt(pack, 50, 50) === -1, "while a zone's map.json is on its way no copy is named");
    // The ask is the frame's own (`mapCopyAt` alone, as the minimap asks it): nothing else here asks for the file first.
    for (let i = 0; i < 10 && !asked.includes(`assets-private/${pack}/map.json`); i++) await new Promise((r) => setTimeout(r, 0));
    ok(asked.includes(`assets-private/${pack}/map.json`), "and the frame's ask starts the file's on its own");
    await mapMeta(pack);
    ok(mapCopyAt(pack, 50, 50) === 1 && mapCopyAt(pack, 250, 50) === 2 && mapCopyAt(pack, 30, 30) === 0 && mapCopyAt(pack, 150, 50) === -1, "then the copy a point stands in is the smallest box holding it, a box the file writes wrongly left out, and none between the copies");
    // A frame asking again while a copy's picture is on its way starts nothing new: the same ask comes back.
    const first = mapCopyPicture(pack, 2);
    ok(mapCopyPicture(pack, 2) === first, "a copy's picture asked twice before it is in is one ask");
    const b = await first;
    ok(!!b && b.frame.width === 120 && b.frame.x === 250 && b.frame.z === 50 && asked.includes(`assets-private/${pack}/map_test_kind_b.png`), "a copy's picture is its kind's own, framed over its own ground");
    await mapCopyPicture(pack, 0);
    await mapCopyPicture(pack, 1);
    ok(asked.filter((p) => p.endsWith('map_test_kind_a.png')).length === 1 && decoded === 2, 'and a picture two copies wear is fetched and decoded once');
    ok(mapPictureNow(pack, 250, 50) === b && mapPictureNow(pack, 30, 30)?.frame.width === 20, 'the minimap and the map window draw the copy the point stands in, once it is in');
    ok(mapPictureNow(pack, 150, 50) === undefined && mapPictureNow(pack) === undefined, "and outside every copy the zone's own picture, still on its way");
  } finally {
    globalThis.fetch = realFetch;
    g.createImageBitmap = realBitmap;
  }
}

// ------------------------------------------------------------------------------------- the ports list
{
  ok(portKindListed('object/building/mustafar/structures/shared_must_new_mining_facility.iff') === 'starport' && portKindOf('object/building/mustafar/structures/shared_must_new_mining_facility.iff') === null, "SOE's starports table makes Mustafar's facility a port for the places list alone");
  const snap = { templates: ['object/building/mustafar/structures/shared_must_new_mining_facility.iff', 'object/tangible/test_folder/test_thing.iff'] };
  const entries = [{ world: { pos: [5000, 0, 5000] }, parentId: 0, node: { templateIndex: 0 } }, ...Array.from({ length: 5 }, (_, i) => ({ world: { pos: [10 + i, 0, 10] }, parentId: 0, node: { templateIndex: 1 } }))];
  const centre = autoCenter(snap, entries);
  ok(centre.x < 100 && /busiest/.test(centre.why), `and never a world's centre, which would move every place on it (${centre.why})`);
  // `status` asks `pois` again of a Mustafar pack written before the facility was a port: its row is missing.
  const facility = { template: 'object/building/mustafar/structures/shared_must_new_mining_facility.iff', x: 10, z: 20 };
  ok(portsWithoutRow([facility], [])[0]?.kind === 'starport' && portsWithoutRow([facility], [{ name: 'test_port', x: 10, z: 20, kind: 'starport' }]).length === 0, "a places list with no row for the facility's port is asked for again, and one with it is not");
  // And a port's place on Mustafar comes out at the world's own arrival, the landing deck (`portArrivesHome`, which the
  // map's teleport, the galaxy tab and a ticket put down on foot ask): the row stands at the facility's origin, over the
  // valley floor. On no other world, and never at a room arrival.
  const mustafar = PLANETS.find((p) => p.id === 'mustafar')!;
  ok(portArrivesHome(mustafar, 'starport') && portArrivesHome(mustafar, 'shuttleport') && !portArrivesHome(mustafar, 'landmark') && !PLANETS.some((p) => p.id !== 'mustafar' && portArrivesHome(p, 'starport')) && !portArrivesHome({ arrival: { raw: { x: 0, z: 0 }, y: 0, port: true, room: { template: 'test_t', cell: 'test_c' } } }, 'starport') && !portArrivesHome({ arrival: { raw: { x: 0, z: 0 }, y: 0 } }, 'starport'), "a port's place on Mustafar comes out at its own arrival, and on no other world");
  // Held to the committed reference: every starport it keeps is a port by name or by the table's own list.
  const idx = existsSync(join(NGE_REF_DIR, 'tables.json')) ? JSON.parse(readFileSync(join(NGE_REF_DIR, 'tables.json'), 'utf8')) : null;
  if (idx?.ports) {
    const ports = Object.keys(idx.ports);
    ok(ports.length > 0 && ports.every((t) => portKindListed(t.replace(/\/([^/]+)$/, '/shared_$1'))) && [...TABLE_PORTS.keys()].every((t) => ports.includes(t.replace('/shared_', '/'))), `every starport the reference keeps is a port of the places list, and the table's list names no other (${ports.length})`);
  } else console.log('note the committed reference has no starports: the ports list is not held to it here');
}

// ------------------------------------------------------------------------------------- the committed reference
// What every converter builds from the reference beside it: counts printed, nothing quoted.
{
  const ref = ngeRefReader(NGE_REF_DIR);
  if (!ref || !ref.zoneLines) console.log('note no reference of the ways beside the converter: its counts are not checked here');
  else {
    const built = buildNgeWays({ reader: ref, zones: WAY_ZONES, areasOf: (z: string) => ref.areas(z) ?? [], kindOf }) as unknown as WaysFile & { counts: Record<string, number>; ports: Record<string, unknown> };
    const c = built.counts;
    console.log(`note the reference's ways: ${JSON.stringify(c)}`);
    ok(c.gates === 36 && c.liftDoors === 12 && c.lifts === 1 && c.guides === 54 && c.moves === 120 && c.launchers === 3 && c.dungeons === 5 && c.copies === 46 && c.droids === 44 && c.ports === 2, 'the reference builds the gates, the tree lift, the guides, the launchers, the five dungeons over their copies, the clone droids and the two starports');
    ok(Object.values(built.dungeons).every((d) => d.starts.length === built.zones[d.zone].areas.filter((a) => a[0] === d.area).length), 'every dungeon has a start in every copy of its area');
    // And each start stands in its own copy, so a death or a reload there comes back at that very start (`copyStartAt`).
    ok(Object.entries(built.dungeons).every(([name, d]) => d.starts.every((s, i) => { const got = copyStartAt(built, d.zone, s[0], s[2]); return got?.dungeon === name && got.copy === i; })), "every copy's start comes back at itself");
    ok(Object.values(built.zones).every((z) => z.lifts.every((l) => l.levels.length === 4)), "the tree lift reaches four levels");
    // Every guide's move lands inside its own zone's areas, and every copy of a zone of copies has a clone droid or a gate out.
    const inside = (zone: string, p: readonly number[]) => built.zones[zone].areas.some((a) => p[0] >= a[1] && p[0] <= a[3] && p[2] >= a[2] && p[2] <= a[4]);
    ok(Object.entries(built.zones).every(([zone, z]) => z.guides.every((g) => g.moves.every((m) => inside(zone, m.to)))), 'every trail move lands inside the trail');
    for (const zone of ['kashyyyk_main', 'kashyyyk_hunting', 'kashyyyk_dead_forest', 'kashyyyk_rryatt_trail', 'kashyyyk_north_dungeons', 'kashyyyk_south_dungeons']) {
      const a = built.zones[zone].areas[0];
      const got = cloneFor(built, zone, (a[1] + a[3]) / 2, (a[2] + a[4]) / 2);
      ok(!!got, `a death in ${zone} comes round at a clone droid (${got?.zone ?? 'none'})`);
    }
    // Mustafar's clone droids all stand in buildings' rooms and are none of the ways': a death there comes round at none
    // of them, and so at the world's own arrival on the deck (wave 6's), not at a droid.
    const must = built.zones.mustafar;
    ok(!!must && must.clones.length === 0 && must.areas.every((a) => cloneFor(built, 'mustafar', (a[1] + a[3]) / 2, (a[2] + a[4]) / 2) === null), `a death on Mustafar comes round at no clone droid (${must?.areas.length ?? 0} areas)`);
  }
}

// ------------------------------------------------------------------------------------- the packs on disk
// What the game reads on this machine (SWG3JS_PACKS, else assets-private), read as the game reads it; a machine without
// the packs prints a note. Counts are printed, nothing of the files is.
{
  const PACKS = process.env.SWG3JS_PACKS ?? join(REPO, 'assets-private');
  const waysFile = join(PACKS, 'nge', 'ways.json');
  const disk = existsSync(waysFile) ? (JSON.parse(readFileSync(waysFile, 'utf8')) as WaysFile) : null;
  if (!disk) console.log('note no nge/ways.json among the packs: the converted gates are not held to the ways here');
  else {
    // Every gate the converter stands (`gates.json`), carried into the game's frame as `ZoneGates` carries it and back into
    // the snapshot's about the world's own layout centre as `gateLandingOf` does, lands where SOE's data says; and every
    // door of SOE's has such a gate within `gateMatch`, the only way the game's E reaches it, so every copy that is not
    // left at its start has a way out. A gate that met none would land at its zone's arrival and say nothing.
    let zonesRead = 0;
    for (const zone of WAY_ZONES) {
      const gf = join(PACKS, zone, 'gates.json');
      const lf = join(PACKS, zone, 'layout.json');
      const z = disk.zones[zone];
      if (!z || !existsSync(gf) || !existsSync(lf)) continue;
      const centre = (JSON.parse(readFileSync(lf, 'utf8')) as { center?: { x: number; z: number } }).center;
      if (!centre) continue;
      zonesRead++;
      const conv = gatesInWorld(JSON.parse(readFileSync(gf, 'utf8')), () => {}).map((g) => toRaw(g.x, g.y, g.z, centre));
      const landed = conv.filter((g) => gateLanding(disk, zone, g[0], g[2]) !== null).length;
      ok(landed === conv.length, `${zone}: every gate the converter stands lands where SOE's data says (${landed} of ${conv.length})`);
      const met = z.gates.filter((g) => conv.some((c) => Math.hypot(c[0] - g.at[0], c[2] - g.at[2]) <= WAYS_TUNE.gateMatch)).length;
      ok(met === z.gates.length, `${zone}: every door of SOE's has a converted gate within reach of it (${met} of ${z.gates.length})`);
    }
    for (const [name, d] of Object.entries(disk.dungeons)) {
      if (d.walkOut) continue;
      const gf = join(PACKS, d.zone, 'gates.json');
      const lf = join(PACKS, d.zone, 'layout.json');
      if (!existsSync(gf) || !existsSync(lf)) continue;
      const centre = (JSON.parse(readFileSync(lf, 'utf8')) as { center: { x: number; z: number } }).center;
      const conv = gatesInWorld(JSON.parse(readFileSync(gf, 'utf8')), () => {}).map((g) => toRaw(g.x, g.y, g.z, centre));
      const boxes = disk.zones[d.zone].areas.filter((a) => a[0] === d.area);
      const out = boxes.filter((b) => conv.some((c) => c[0] >= b[1] && c[0] <= b[3] && c[2] >= b[2] && c[2] <= b[4] && (() => { const l = gateLanding(disk, d.zone, c[0], c[2]); return !!l && 'zone' in l && l.zone !== d.zone; })())).length;
      ok(out === boxes.length, `${name}: every copy has a converted gate out of it (${out} of ${boxes.length})`);
    }
    if (!zonesRead) console.log('note no zone of the ways is converted with its gates here');
  }

  // Mustafar's port lands people at the world's own arrival: SOE's starports table's arrival for the facility, by the
  // server's own arithmetic about the facility as this pack places it, stands within a few metres of the deck's place
  // (`PlanetDef.arrival`), which is why a port's place there comes out at that arrival (`portArrivesHome`).
  const mustLayout = join(PACKS, 'mustafar', 'layout.json');
  const tables = existsSync(join(NGE_REF_DIR, 'tables.json')) ? JSON.parse(readFileSync(join(NGE_REF_DIR, 'tables.json'), 'utf8')) : null;
  const port = tables?.ports?.['object/building/mustafar/structures/must_new_mining_facility.iff'];
  if (!existsSync(mustLayout) || !port?.arrival) console.log("note Mustafar's pack or the reference's starports are not here: its port's arrival is not held to the deck");
  else {
    const objs = (JSON.parse(readFileSync(mustLayout, 'utf8')) as { objects: { template: string; contained?: boolean; x: number; y: number; z: number; q: number[] }[] }).objects;
    const fac = objs.find((o) => !o.contained && o.template === 'object/building/mustafar/structures/shared_must_new_mining_facility.iff');
    const a = PLANETS.find((p) => p.id === 'mustafar')!.arrival!;
    if (!fac) console.log("note Mustafar's pack places no mining facility: its port's arrival is not held to the deck");
    else {
      const yaw = yawOf(fac.q);
      const [dx, dy, dz] = port.arrival as number[];
      const x = fac.x - (dx * Math.cos(yaw) + dz * Math.sin(yaw));
      const z = fac.z - (dz * Math.cos(yaw) - dx * Math.sin(yaw));
      const y = fac.y - dy;
      const d = Math.hypot(x - a.raw.x, z - a.raw.z);
      ok(d < 12 && Math.abs(y - a.y) < 1, `the facility's starport lands its people on the deck, ${d.toFixed(1)} m from the world's own arrival and ${Math.abs(y - a.y).toFixed(2)} m off its height`);
    }
  }

  // Every ticket collector out of doors stands within `COLLECTOR_DECK` (1 m, ours) of the ground the game makes under it
  // (the terrain with the buildings' own layers laid on, as `SwgTerrain` lays them), but Mensix's on its deck: so only that
  // one is stood at its row's own height and held there until the deck is solid, and every other one keeps the ground
  // lookup it always had. Measured on the packs at hand; the layers within 600 m of a collector are the ones laid.
  const deckLine = Number((src('src/main.ts').match(/const COLLECTOR_DECK = (\d+(?:\.\d+)?);/) ?? [])[1]);
  let worlds = 0;
  const decks: string[] = [];
  let most = 0;
  for (const name of existsSync(PACKS) ? readdirSync(PACKS) : []) {
    const dir = join(PACKS, name);
    const tf = join(dir, 'travel.json');
    const lf = join(dir, 'layout.json');
    if (!existsSync(tf) || !existsSync(lf)) continue;
    const cols = ((JSON.parse(readFileSync(tf, 'utf8')) as { rows?: { kind: string; cell?: number; x: number; y: number; z: number }[] }).rows ?? []).filter((r) => r.kind === 'collector' && !r.cell);
    if (!cols.length) continue;
    const layout = JSON.parse(readFileSync(lf, 'utf8')) as { terrain?: string; objects: { contained?: boolean; layer?: string; x: number; z: number; q: number[] }[] };
    if (!layout.terrain || !existsSync(join(dir, layout.terrain))) continue;
    const template = parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, layout.terrain))));
    for (const b of bitmapFiles(template)) {
      const f = join(dir, b.file);
      if (existsSync(f)) attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
    }
    const sampler = new TerrainSampler(template);
    for (const o of layout.objects) {
      if (o.contained || !o.layer || !existsSync(join(dir, o.layer)) || !cols.some((c) => Math.hypot(c.x - o.x, c.z - o.z) < 600)) continue;
      const layer = parseLayerFile(new Uint8Array(readFileSync(join(dir, o.layer))), template.generator);
      if (layer) sampler.addBuildingLayer(layer, o.x, o.z, yawOf(o.q));
    }
    worlds++;
    for (const c of cols) {
      const over = c.y - sampler.heightAt(c.x, c.z);
      if (over > deckLine) decks.push(`${name} ${over.toFixed(1)} m`);
      else most = Math.max(most, over);
    }
  }
  if (!worlds) console.log('note no converted world with travel rows here: the collectors are not measured against COLLECTOR_DECK');
  else ok(deckLine === 1 && decks.length <= 1 && decks.every((d) => d.startsWith('mustafar ')), `over ${worlds} worlds no collector out of doors but Mensix's stands more than COLLECTOR_DECK over the ground (the most ${most.toFixed(2)} m; on a deck: ${decks.join(', ') || 'none'})`);
}

// ------------------------------------------------------------------------------------- the hand-overs
// What only the game does with the ways, pinned as text: every behaviour above is built by the test for itself.
{
  const main = src('src/main.ts');
  ok(/const landing = this\.gateLandingOf\(near\.gate\.x, near\.gate\.y, near\.gate\.z\);\s*if \(landing\) void this\.goByWay\(landing, near\.gate\.label \?\? dest\.zone\.name\);\s*else void this\.travel\(dest\.planet, dest\.zone\.id\);/.test(main), "a zone gate lands where SOE's door says, and where none says, where it always did");
  ok(/return gateLanding\(ngeWays\.now, packIdOf\(this\.world\.planet, this\.zone\), raw\[0\], raw\[2\]\);/.test(main) && /const raw = toRaw\(x, y, z, c\);/.test(main), "the gate is looked up in the snapshot's frame of this world's own pack");
  ok(/const into = copyStart\(ngeWays\.now, landing\.dungeon, this\.copyId\(\)\);/.test(main) && /return this\.groupIdNow\(\) \|\| this\.current\?\.id \|\| 'nobody';/.test(main), "a copy is the group's, else the character's, as every dungeon's is");
  ok(/const centre = await this\.poisFileOf\(pack\)\.then\(\(f\) => f\.center, \(\) => null\);/.test(main) && /await this\.travel\(planet, zoneId, undefined, \{ at: new THREE\.Vector3\(g\[0\], g\[1\], g\[2\]\), label, wayFloor: true \}\);/.test(main), "another zone's place is worked out from its places file before the travel, and stood on its floor");
  ok(/if \(opts\.wayFloor\) this\.standOnWay\(at, 'arrive'\);/.test(main) && /if \(opts\.ground \|\| opts\.wayFloor\) \{/.test(main), 'the travel stands a place of the ways on its floor and keeps it as the spawn');
  ok(/const d = this\.physics\.groundDistance\(at\.x, at\.y \+ WAYS_TUNE\.lift, at\.z, WAYS_TUNE\.lift \+ WAYS_TUNE\.drop, p\.body\);\s*const y = wayFloorAt\(at\.y, ground, d === null \? null : at\.y \+ WAYS_TUNE\.lift - d\);/.test(main), 'and the floor is the rule the test runs, looked for from a little over the place to a little under it');
  ok(/\/\/ A tree lift's door of SOE's data \(Kachirho's, `ngeWays\.ts`\): its levels in the lift menu, as a shaft's are\.\s*const tree = this\.treeLiftHere\(\);\s*if \(tree\) \{\s*this\.openTreeLift\(tree\);\s*return true;/.test(main), 'E at a tree lift door opens its levels before anything else the key could mean');
  ok(/this\.liftMenu\.onPick = \(i\) => \(this\.wayStops \? this\.rideWay\(i\) : this\.rideLift\(i\)\);/.test(main) && /this\.wayStops = null;\s*this\.liftMenu\.hide\(\);/.test(main), "the lift menu's pick rides a way's stop, and closing it lets the stops go");
  ok(/const tree = this\.treeLiftHere\(\);\s*s\.lift = !!lift \|\| !!tree;/.test(main), 'the bar offers the tree lift as the lift');
  ok(/if \(!use && !inCopy\) return this\.gatherWay\(\);/.test(main) && /if \(this\.wayHere\) return this\.useWay\(\);/.test(main), "a guide, a launcher and a copy's way out are the use key's, out of a building's copy");
  // What the key does there: the rule the test runs (`wayAt`), with a way that leaves standing aside as a zone gate does.
  const gather = methodOf(main, '  private gatherWay(): InstanceUse {');
  ok(/const leave = this\.zoneGates\.since\(this\.world\.simTime\) >= GATE_TUNE\.calm && !this\.companion\.revivable\(at\.x, at\.z\);\s*const way = wayAt\(ways, here\.pack, x, y, z, leave\);\s*this\.wayHere = way;\s*return way \? way\.kind : '';/.test(gather), "the use key takes the way `wayAt` names, a way that leaves standing aside after a blow and beside somebody to get up");
  const use = methodOf(main, '  private useWay(): boolean {');
  ok(/if \(w\.kind === 'guide'\) \{\s*this\.openGuide\(w\.guide\);/.test(use) && /if \(d\) void this\.goByWay\(\{ dungeon: w\.dungeon \}, name\);/.test(use) && /void this\.goToRaw\(w\.exit\.zone, w\.exit\.at, back\);/.test(use), "a guide opens its moves, a launcher sends the group into its own copy (`goByWay`'s `copyStart`), and a way out goes to the dungeon's exit");
  // The lift and the guide are moves within the zone (`Player.stand`), everything else an arrival (`Player.reset`, the spawn).
  const move = methodOf(main, "  private async moveToWay(at: THREE.Vector3, label: string, how: 'arrive' | 'move'): Promise<boolean> {");
  ok((move.match(/if \(how === 'move'\) p\.stand\(at\.clone\(\)\);\s*else p\.reset\(at\.clone\(\)\);/g) ?? []).length === 2 && (move.match(/this\.standOnWay\(at, how\);\s*if \(how === 'arrive'\) this\.spawn\.copy\(p\.pos\);/g) ?? []).length === 2 && !/this\.spawn\./.test(move.replace(/if \(how === 'arrive'\) this\.spawn\.copy\(p\.pos\);/g, '')), "a move keeps the player's health and leaves the spawn, an arrival stands them up whole and keeps the place as the spawn");
  ok(/if \(how === 'move'\) p\.stand\(new THREE\.Vector3\(at\.x, y, at\.z\)\);\s*else p\.reset\(new THREE\.Vector3\(at\.x, y, at\.z\)\);/.test(methodOf(main, "  private standOnWay(at: THREE.Vector3, how: 'arrive' | 'move'): void {")), 'and so does the floor it is stood on');
  ok(/void this\.moveToWay\(stop\.at\.clone\(\), stop\.label, 'move'\)/.test(methodOf(main, '  private rideWay(index: number): void {')), "a tree lift's level and a guide's step are moves");
  ok(!/goToRaw\([^)]*'move'\)/.test(main) && !/goByWay\([^)]*'move'/.test(main), 'and nothing else is: a gate, a copy, a way out and a clone droid are arrivals');
  // The clone droid: asked whether its zone can be gone to before the death is put away, and a move refused comes round plain.
  const droidAt = methodOf(main, '  private async respawnAtDroid(): Promise<void> {');
  ok(/if \(!\(await this\.wayReachable\(droid\.pack, 'the clone droid'\)\)\) \{[\s\S]*?return;\s*\}[\s\S]*?this\.endDeathForWay\(\);\s*if \(await this\.goToRaw\(droid\.pack, droid\.at, 'the clone droid'\)\) \{[\s\S]*?return;\s*\}\s*this\.respawn\(true\);/.test(droidAt) && droidAt.indexOf('wayReachable') < droidAt.indexOf('endDeathForWay'), "the clone droid's zone is asked about before the death is put away, and a move refused comes round as the plain Respawn does");
  const endDeath = methodOf(main, '  private endDeathForWay(): void {');
  ok(/this\.death\.classList\.remove\('on'\);/.test(endDeath) && /this\.player\.endRagdoll\(\);/.test(endDeath) && /this\.stepOffForRespawn\(\);/.test(endDeath) && /this\.dying = false;/.test(endDeath), 'and the death is put away whole before a way stands the player up');
  // A death in a grid copy comes round at that copy's start, and a reload there takes it as the spawn.
  ok(/const start = plain \|\| this\.rideRescue \|\| this\.traveling \? null : this\.copyStartHere\(\);\s*if \(start\) \{\s*void this\.respawnAtCopyStart\(start\);/.test(methodOf(main, '  private respawn(plain = false): void {')) && /return here \? copyStartAt\(ngeWays\.now, here\.pack, here\.at\[0\], here\.at\[2\]\) : null;/.test(main), "the plain Respawn in a grid copy comes round at that copy's own start, the rule the test runs");
  ok(/this\.endDeathForWay\(\);\s*if \(await this\.goToRaw\(start\.zone, start\.at, 'coming round'\)\) \{[\s\S]*?\}\s*this\.respawn\(true\);/.test(methodOf(main, '  private async respawnAtCopyStart(start: { zone: string; at: V3 }): Promise<void> {')), 'stood on its floor by the ways as an arrival, else at the spawn');
  ok(/const gridStart = at && placesFor === packIdOf\(this\.world\.planet, this\.zone\) \? this\.gridCopyStart\(at\) : null;\s*if \(gridStart\) this\.spawn\.copy\(gridStart\);/.test(main) && /const got = copyStartAt\(ngeWays\.now, packIdOf\(this\.world\.planet, this\.zone\), raw\[0\], raw\[2\]\);/.test(main), "a character put back in a grid copy takes that copy's start as its spawn, which the overlay's arrival clear keeps to");
  // A port's place on a world whose arrival is its port's landing (Mustafar's deck) comes out at that arrival.
  const tele = methodOf(main, '  private async teleport(planet: PlanetDef, poi: Poi, zoneId?: string, fromRide = false): Promise<void> {');
  ok(/if \(portArrivesHome\(planet, poi\.kind\)\) \{\s*if \(planet\.id !== this\.world\.planet\.id\) \{\s*await this\.travel\(planet, zoneId, undefined, \{ label: poi\.name \}\);\s*return;\s*\}\s*const home = this\.arrivalHome;\s*if \(home\) \{[\s\S]*?await this\.standAtHome\(at, home,/.test(tele) && tele.indexOf('portArrivesHome') < tele.indexOf('placeFromPois'), "a port's place on Mustafar comes out on the deck, from another world by its own arrival and on this one stood there as a death is");
  ok(/arrival: \{ raw: \{ x: -2478\.1, z: 1620\.0 \}, y: 230\.4, heading: -0\.37, port: true \}/.test(src('src/data/planets.ts')), "Mustafar's arrival is its port's landing");
  ok(/const droid = rows\.length \|\| this\.world\.planet\?\.space \? null : this\.cloneDroidHere\(\);/.test(main) && /row\.addEventListener\('click', \(\) => void this\.respawnAtDroid\(\)\);/.test(main), 'a world with no facility offers the clone droid the mapping names on the death card');
  ok(/const got = cloneFor\(ngeWays\.now, here\.pack, here\.at\[0\], here\.at\[2\]\);/.test(main), 'the droid is the rule the test runs');
  ok(/void ngeWays\.fetch\(import\.meta\.env\.BASE_URL\);/.test(main), 'the ways are asked for once a session at boot');
  ok(/if \(o\.tune\) tuneWays\(o\.tune\);/.test(methodOf(main, '  private async debugWays(')) && /if \(await this\.packConverted\(pack\)\) return true;/.test(methodOf(main, '  private async wayReachable(pack: string, label: string): Promise<boolean> {')), "the console's knobs reach the ways, and a zone not converted is no zone a way goes to");
  ok(/const deck = !w\.inside && w\.y - this\.world\.terrain\.heightAt\(w\.x, w\.z\) > COLLECTOR_DECK;\s*const droid = this\.world\.standMobile\(w\.model, w\.inside \|\| deck \? \{ x: w\.x, y: w\.y, z: w\.z, heading: w\.yaw \} : \{ x: w\.x, z: w\.z, heading: w\.yaw \}, w\.inside, w\.key, true\);/.test(main), "a ticket collector out of doors on a deck (Mensix's, 125 m over the valley) is stood at its row's own height, held there until the deck is solid, and every other one on the ground as before");
  ok(/return c \? mapPictureNow\(pack, gameToRawX\(c\.x, at\.x\), gameToRawZ\(c\.z, at\.z\)\) : mapPictureNow\(pack\);/.test(main), "the minimap draws the picture of the copy the map's own point stands in");
  const mapUi = src('src/ui/mapUi.ts');
  ok(/const copy = mc \? mapCopyAt\(packId, mapFromGameX\(mc\.x, me\.x\), mapFromGameZ\(mc\.z, me\.z\)\) : -1;/.test(mapUi) && /return copy >= 0 \? mapCopyPicture\(packId, copy\) : mapPicture\(packId\);/.test(mapUi), 'and so does the map window');
  const cli = src('tools/swg/cli.mjs');
  ok(/writeFileSync\(join\(outDir, 'ways\.json'\), JSON\.stringify\(built\.ways\)\);/.test(cli), 'spawns writes the ways beside the overlay');
  ok(/const ngePorts = await ngePortChildren\(T\);\s*for \(const \[t, kids\] of ngePorts\) if \(!byTemplate\.has\(t\)\) byTemplate\.set\(t, kids\);/.test(cli) && /const kids = childCellsFor\(byTemplate,/.test(cli) && /const rows = T\.placeChildren\(layout\.objects \?\? \[\], kids\.byTemplate\);/.test(cli), "travel stands the starports' children through the very builder the reference is checked with");
  ok(/const ways = W\.buildNgeWays\(\{ reader, zones: W\.WAY_ZONES, areasOf: \(z\) => reader\.areas\(z\) \?\? \[\], kindOf \}\);/.test(cli), 'from the reference, or a live copy, or none');
  ok(/const copies = instanceFramesOf\(\{ planet, areas: areaRows, instanceAreas, hasPicture: \(n\) => vfs\.has\(`texture\/\$\{n\}\.dds`\) \}\);/.test(cli) && /meta\.instances = copies\.map/.test(cli), "maps writes a zone of copies' pictures and frames");
  ok(/if \(travel && layout && ngePortsUnstood\(layout\.objects, travel\.rows, ngePortBuildings, travel\.nge === 'none'\)\) wantTravel = true;/.test(cli) && /return m && m\.image && m\.frame === 'terrain' && !Array\.isArray\(m\.instances\);/.test(cli), 'status asks for travel and maps again of packs from before, and never of travel written with --nge=none');
  ok(/const ngeLeftOut = NGE_WORD\?\.value === 'none';/.test(cli) && /\.\.\.\(ngeLeftOut \? \{ nge: 'none' \} : \{\}\), counts, rigs: used, rows \}/.test(cli), 'travel with --nge=none says so in the file it writes');
  ok(/const kind = portKindListed\(template\);/.test(cli) && !/portKindListed/.test(src('tools/swg/places.mjs').slice(src('tools/swg/places.mjs').indexOf('export function autoCenter'), src('tools/swg/places.mjs').indexOf('export function autoCenter') + 600)), "the places list takes the table's ports, and a world's centre does not");
  const ngepack = src('tools/swg/ngepack.mjs');
  ok(/const ways = buildNgeWays\(\{ reader, zones: wayZones\.filter\(\(z\) => zones\.includes\(z\) && packs\[z\]\), areasOf: \(zone\) => clientAreas\?\.\(zone\) \?\? reader\.areas\(zone\) \?\? \[\], kindOf \}\);/.test(ngepack) && /return \{ index, manifest, packs, ways \};/.test(ngepack), 'the overlay builds the ways from the same areas as the people, and hands them on');
  const ngeref = src('tools/swg/ngeref.mjs');
  ok(/ways: built\.ways \? strip\(built\.ways\) : null/.test(ngeref), 'and the reference is held to the copy on them');
}

rmSync(root, { recursive: true, force: true });
console.log(`${passed} checks passed`);
