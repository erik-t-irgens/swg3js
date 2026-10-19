// The NGE overlay's converter half (`tools/swg/nge.mjs`, the reader, and `tools/swg/ngepack.mjs`, the rules): SOE's
// own placements for Kashyyyk and Mustafar read off a local copy into packs the game already reads.
//
// **Nothing of the copy is in this file.** The tree it reads is written into the system's temporary folder at run
// time from the literals below, every name in it `test_*` (a self-check reads back every file written and fails the
// run if one is not), shaped as the copy is shaped -- the checkout's `dsrc/sku.0/sys.server/compiled/game/datatables`
// and its shared twin, a mobile's `.tpf` -- since the shape of a table is format knowledge and its rows are not ours
// to quote. The crews' building and its rooms are handed in as nodes, as the archives' buildouts would give them.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitPlace, makeNgeReader, ngeRoots, parseObjvars, parseTab } from '../nge.mjs';
import {
  NGE_FORMAT, NGE_PREFIX, NGE_RULES, buildNgeOverlay, holdsWhole, kindOf, ngeArg, ngeKey, ngeStatus, overlayTarget, regionAreas, rowIds, sharedOf, sourceInside, spawnerPlace, yawOfQ,
} from '../ngepack.mjs';
import { STATIC_TUNE, unitOf } from '../core3.mjs';
import { mergeBuildouts } from '../buildout.mjs';
import { gameOf } from '../spawnpack.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ------------------------------------------------------------------------------------------- the tree

/** A table's text: a row of columns, a row of types, then the rows, tab-separated as the copy writes them. */
function tab(columns: string[], types: string[], rows: (string | number)[][]): string {
  return [columns.join('\t'), types.join('\t'), ...rows.map((r) => r.map(String).join('\t'))].join('\r\n') + '\r\n';
}
/** Objvars as a buildout row writes them: name, type, value, ended by `$`. */
function objvars(pairs: [string, string | number][]): string {
  return pairs.length ? `${pairs.map(([k, v]) => `${k}|${typeof v === 'number' ? (Number.isInteger(v) ? 0 : 2) : 4}|${v}`).join('|')}|$|` : '';
}
/**
 * The TEST ground: it rises a tenth of a metre a metre along x and starts again every two kilometres, so both
 * copies of an area (two kilometres apart) stand on the same heights, and the ground at a place and at its mirror
 * (-x) are never the same: the frame check can tell the two apart, and a drawn row's height is its own spot's.
 */
const ground = (x: number): number => 0.1 * (((x % 2000) + 2000) % 2000);
/** The ground under a row of an area whose corner is at x 1000 (or 3000, or 5000), `px` along it. */
const on = (px: number): number => ground(1000 + px);
const Q_ID = [1, 0, 0, 0];
const TURN = 1.2;
const Q_TURNED = [Math.cos(TURN / 2), 0, Math.sin(TURN / 2), 0];
const AREA = 'object/tangible/ground_spawning/area_spawner.iff';
const PATROL = 'object/tangible/ground_spawning/patrol_spawner.iff';
const POINT = 'object/tangible/ground_spawning/patrol_waypoint.iff';
const COLS = ['objid', 'container', 'server_template_crc', 'cell_index', 'px', 'py', 'pz', 'qw', 'qx', 'qy', 'qz', 'scripts', 'objvars'];
const TYPES = ['i', 'i', 'h', 'i', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 's', 'p'];
const row = (objid: number, template: string, p: number[], q: number[], scripts: string, ov: [string, string | number][], container = 0, cell = 0): (string | number)[] => [objid, container, template, cell, p[0], p[1], p[2], q[0], q[1], q[2], q[3], scripts, objvars(ov)];
const SPAWN = (name: string, count: number, radius: number, behaviour: number | null, min = 60, max = 120): [string, string | number][] => [
  ['strSpawns', name], ['intSpawnCount', count], ['fltRadius', radius + 0.0001], ...(behaviour === null ? [] : ([['intDefaultBehavior', behaviour]] as [string, number][])), ['fltMinSpawnTime', min + 0.0001], ['fltMaxSpawnTime', max + 0.0001],
];

/** The buildout's rows, one area's: in the order a test may turn round. */
function buildoutRows(): (string | number)[][] {
  return [
    // An area spawner drawing from a type table: three, ten metres, loitering.
    row(11, AREA, [10, on(10), 20], Q_ID, 'systems.spawning.spawner_area', SPAWN('test_type_a', 3, 10, 2)),
    // One naming a creature outright, standing guard.
    row(12, AREA, [40, on(40), 20], Q_ID, 'systems.spawning.spawner_area', SPAWN('test_creature_plain', 1, 6, 1, 30, 30)),
    // A patrol with a point no waypoint names, and one whose points are all there; both stop (behaviour 3).
    row(13, PATROL, [60, on(60), 20], Q_ID, 'systems.spawning.spawner_patrol', [...SPAWN('test_creature_plain', 1, 0, 3), ['strPatrolPointNames', 'test_point_one:test_point_two:test_point_three']]),
    row(14, PATROL, [62, on(62), 20], Q_ID, 'systems.spawning.spawner_patrol', [...SPAWN('test_creature_plain', 1, 0, 3), ['strPatrolPointNames', 'test_point_one,test_point_two']]),
    row(15, POINT, [70, on(70), 30], Q_ID, '', [['pointName', 'test_point_one']]),
    row(16, POINT, [80, on(80), 30], Q_ID, '', [['pointName', 'test_point_two']]),
    // A static NPC turned and stood a little over the ground, a corpse, and a spawner well over the ground.
    row(17, 'object/tangible/spawning/ep3/quest_npc/test_static_spawner.iff', [100, on(100) + 1.5, 100], Q_TURNED, 'npc.celebrity.celebrity_spawner', [['npc_name', 'test_name'], ['spawns', 'test_creature_tpf']]),
    row(18, 'object/tangible/spawning/static_npc/test_corpse_spawner.iff', [120, on(120), 100], Q_ID, 'npc.celebrity.corpse_spawner', [['npc_name', 'test_name'], ['spawns', 'test_creature_dress']]),
    row(20, AREA, [200, on(200) + 25, 200], Q_ID, 'systems.spawning.spawner_area', SPAWN('test_creature_plain', 4, 30, 2)),
    // Two spawners whose own data names nobody, so a script of the server's stands their people: told by shape, not name.
    row(19, AREA, [140, on(140), 100], Q_ID, 'systems.combat.test_mine_spawner', [['test_mine_count', 3]]),
    row(24, 'object/tangible/spawning/test_folder/test_bet_spawner.iff', [150, on(150), 100], Q_ID, 'theme_park.test_folder.test_bet_spawner', [['test_bet_count', 2]]),
    // An ungated spawner whose behaviour is not written: the table's own default, wander.
    row(25, AREA, [160, on(160), 100], Q_ID, 'systems.spawning.spawner_area', SPAWN('test_creature_plain', 2, 4, null, 40, 400)),
    // A building the pack places too (the frame's witness), the crew's building, and a spawner in one of its rooms.
    row(21, 'object/building/test_folder/test_hut.iff', [50, 0, 60], Q_ID, '', []),
    row(22, 'object/building/test_folder/test_dungeon.iff', [300, 0, 300], Q_ID, 'theme_park.dungeon.generic_spawner', [['spawn_table', 'datatables/spawning/dungeon/test_crew_table.iff']]),
    row(23, AREA, [1, 0, 1], Q_ID, 'systems.spawning.spawner_area', SPAWN('test_creature_plain', 1, 2, 1), 22, 1),
  ];
}

/** An area table written with no `objid` and no `container` column at all, as some areas' tables are. */
const PLAIN_COLS = ['server_template_crc', 'cell_index', 'px', 'py', 'pz', 'qw', 'qx', 'qy', 'qz', 'scripts', 'objvars'];
const PLAIN_TYPES = ['h', 'i', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 's', 'p'];
const plain = (template: string, p: number[], scripts: string, ov: [string, string | number][]): (string | number)[] => [template, 0, p[0], p[1], p[2], 1, 0, 0, 0, scripts, objvars(ov)];
function plainRows(): (string | number)[][] {
  const twin = plain(AREA, [400, on(400), 400], 'systems.spawning.spawner_area', SPAWN('test_type_a', 2, 10, 2));
  return [
    // Two spawners three hundred metres apart, every objvar the same.
    plain(AREA, [100, on(100), 100], 'systems.spawning.spawner_area', SPAWN('test_type_a', 2, 10, 2)),
    plain(AREA, [400, on(400), 100], 'systems.spawning.spawner_area', SPAWN('test_type_a', 2, 10, 2)),
    // Two written exactly alike, on one spot.
    twin,
    [...twin],
    // A static NPC, which must not share a name with any spawner's first.
    plain('object/tangible/spawning/ep3/quest_npc/test_static_spawner.iff', [200, on(200), 200], 'npc.celebrity.celebrity_spawner', [['spawns', 'test_creature_tpf']]),
  ];
}

const CREW = [
  ['test_creature_crew', '', 'test_room_a', 2, 0.5, 3, 90, '', '', 600],
  // Its twin, the very same row: two people on one spot, each a name of their own.
  ['test_creature_crew', '', 'test_room_a', 2, 0.5, 3, 90, '', '', 600],
  ['object/tangible/test_folder/test_crate.iff', '', 'test_room_a', 1, 0, 1, 0, '', '', 0],
  ['test_creature_crew', '', 'test_room_missing', 0, 0, 0, 0, '', '', 0],
  ['test_type_a', '', 'test_room_b', -1, 0, 2, 180, '', '', 300],
];

/** The whole tree, written under `root`; `turned` writes the buildouts' and the crew's rows the other way round. */
function writeTree(root: string, turned = false): void {
  const server = join(root, 'dsrc', 'sku.0', 'sys.server', 'compiled', 'game', 'datatables');
  const shared = join(root, 'dsrc', 'sku.0', 'sys.shared', 'compiled', 'game', 'datatables');
  const put = (base: string, rel: string, text: string): void => {
    const p = join(base, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, 'latin1');
  };
  const turn = <T>(list: T[]): T[] => (turned ? [...list].reverse() : list);
  put(shared, 'buildout/areas_test_zone.tab', tab(['area', 'x1', 'z1', 'x2', 'z2', 'eventRequired'], ['s', 'f', 'f', 'f', 'f', 's'], [['test_area', 1000, 2000, 1500, 2500, ''], ['test_area', 3000, 2000, 3500, 2500, ''], ['test_event_area', 0, 0, 10, 10, 'test_event']]));
  put(server, 'buildout/test_zone/test_area.tab', tab(COLS, TYPES, turn(buildoutRows())));
  put(server, 'buildout/test_zone/test_event_area.tab', tab(COLS, TYPES, [row(31, AREA, [1, 0, 1], Q_ID, 'systems.spawning.spawner_area', SPAWN('test_creature_plain', 1, 2, 1))]));
  put(shared, 'buildout/areas_test_zone_plain.tab', tab(['area', 'x1', 'z1', 'x2', 'z2', 'eventRequired'], ['s', 'f', 'f', 'f', 'f', 's'], [['test_area_plain', 5000, 5000, 5600, 5600, '']]));
  put(server, 'buildout/test_zone_plain/test_area_plain.tab', tab(PLAIN_COLS, PLAIN_TYPES, turn(plainRows())));
  put(server, 'spawning/ground_spawning/types/test_world/test_type_a.tab', tab(['strItem', 'fltSize'], ['s', 'f'], [['test_creature_plain', 1], ['test_type_b', 1]]));
  put(server, 'spawning/ground_spawning/types/test_world/test_type_b.tab', tab(['strItem', 'fltSize'], ['s', 'f'], [['test_creature_tpf', 1]]));
  const ccols = ['creatureName', 'BaseLevel', 'difficultyClass', 'template', 'aggressive', 'invulnerable', 'herd', 'stalker', 'death_blow', 'primary_weapon', 'primary_weapon_speed', 'secondary_weapon', 'socialGroup', 'pvpFaction', 'niche'];
  const ctypes = ['s[required]', 'i[0]', 'e(NORMAL=0,ELITE=1,BOSS=2)[NORMAL]', 's[required]', 'f[0.0]', 'b[0]', 'b[0]', 'b[0]', 'e(no=0,yes=1,instant=2)[no]', 's[unarmed]', 'f[2.0]', 's[none]', 's[required]', 's', 'e(none=0,npc=5,monster=6,herbivore=7,carnivore=8)[monster]'];
  put(server, 'mob/creatures.tab', tab(ccols, ctypes, [
    ['test_creature_plain', 10, 'NORMAL', 'test_folder/test_body_plain.iff', 0, 0, 1, 0, 'no', '', '', '', 'test_social', '', 'herbivore'],
    ['test_creature_tpf', 20, '1', 'test_folder/test_server_body.iff', 12, 0, 0, 1, 'yes', 'test_weapon_word', 3, 'none', 'test_social', 'test_faction', 'npc'],
    ['test_creature_dress', 30, 'BOSS', 'test_dress_list', 0, 1, 0, 0, 'no', '', '', '', 'test_social', '', 'npc'],
    ['test_creature_lair', 20, 'NORMAL', 'test_folder/test_body_lair.iff', 8, 0, 1, 0, 'no', '', '', '', 'test_social', '', 'carnivore'],
    ['test_creature_crew', 30, 'NORMAL', 'object/mobile/test_folder/test_body_crew.iff', 0, 0, 0, 0, 'no', 'test_weapon_word', '', '', 'test_social', '', 'npc'],
    ['test_creature_unused', 5, 'NORMAL', 'test_folder/test_body_plain.iff', 0, 0, 0, 0, 'no', '', '', '', 'test_social', '', 'monster'],
  ]));
  put(join(root, 'dsrc', 'sku.0', 'sys.server', 'compiled', 'game'), 'object/mobile/test_folder/test_server_body.tpf', '@base object/mobile/base/test_base.iff\n\nsharedTemplate = "object/mobile/test_folder/shared_test_client_body.iff"\n');
  put(server, 'npc_customization/dressed_species_t.tab', tab(['test_dress_list'], ['s'], [['object/mobile/test_folder/test_dressed_one.iff'], ['test_folder/test_dressed_two']]));
  put(server, 'mob/stat_balance.tab', tab(['Level', 'HP', 'damagePerSecond', 'Elite_HP', 'Elite_damagePerSecond', 'Boss_HP', 'Boss_damagePerSecond'], ['i', 'i', 'f', 'i', 'f', 'i', 'f'], [[1, 100, 5, 300, 10, 1000, 20], [10, 900, 30, 2000, 60, 5000, 100], [20, 1600, 60, 4000, 120, 9000, 200], [30, 2500, 90, 6000, 180, 20000, 400]]));
  put(server, 'ai/ai_weapons.tab', tab(['weapon_id', 'weapon1', 'weapon2', 'weapon3', 'weapon4'], ['s', 's', 's', 's', 's'], [['test_weapon_word', 'object/weapon/ranged/rifle/test_rifle.iff', '', '', '']]));
  put(server, 'region/region_test_zone.tab', tab(['regionName', 'geometry', 'minX_or_centerX', 'minZ_or_centerZ', 'maxX_or_radius', 'maxZ', 'spawnableType'], ['s', '"e(rectangle=0,circle=1)[rectangle]"', 'f', 'f', 'f', 'f', '"e(spawnFalse=0,spawnTrue=1,mission=2,default=3,difficulty=5)[spawnFalse]"'], [
    ['@test_region_names:test_spawn_one', 'rectangle', -2000, -2000, -1000, -1000, 'spawnTrue'],
    ['@test_region_names:test_spawn_two', 1, 1000, 1000, 400, '', 'spawnTrue'],
    ['test_no_spawn_all', 'rectangle', -5000, -5000, 5000, 5000, 'spawnFalse'],
    ['test_no_spawn_small', 'circle', 1000, 1000, 50, '', ''],
    ['test_mission_region', 'rectangle', 0, 0, 10, 10, 'mission'],
  ]));
  const lcols = ['strTemplate', 'intSpawnLimit', 'intMinDifficulty', 'intMaxDifficulty', 'intWeighting', 'intSize', 'intNumToSpawn', 'strTemplateToSpawn', 'strLairType', 'strBuildingType'];
  const ltypes = ['s', 'i', 'i', 'i', 'i', 'i', 'i', 's', 's', 's'];
  put(server, 'spawning/spawn_lists/test_zone/test_spawn_one.tab', tab(lcols, ltypes, [['object/tangible/lair/test_npc_lair.iff', -1, 0, 0, 15, 25, '', '', 'test_lair_one', '']]));
  put(server, 'spawning/spawn_lists/test_zone/test_spawn_two.tab', tab(lcols, ltypes, [['object/tangible/lair/test_npc_lair.iff', -1, 0, 0, 5, 20, '', '', 'test_lair_one', '']]));
  put(server, 'npc_lair/test_lair_one.tab', tab(['mobiles', 'spawnLimit', 'comments', 'buildingsToSpawn', 'veryEasy', 'easy', 'medium', 'hard', 'veryHard'], ['s', 'i[-1]', 'c', 'c', 's', 's', 's', 's', 's'], [['test_creature_lair', 4, '', '', '', '', '', '', ''], ['test_creature_plain', 2, '', '', '', '', '', '', '']]));
  put(server, 'spawning/dungeon/test_crew_table.tab', tab(['spawns', 'name', 'room', 'loc_x', 'loc_y', 'loc_z', 'yaw', 'script', 'mood', 'respawn_time'], ['s', 's', 's', 'f', 'f', 'f', 'f', 's', 's', 'i'], turn(CREW)));
}

const root = mkdtempSync(join(tmpdir(), 'test_nge_tree_'));
const turnedRoot = mkdtempSync(join(tmpdir(), 'test_nge_turned_'));
writeTree(root);
writeTree(turnedRoot, true);

// Every name the tree carries begins `test_`: the self-check, over **every file written** read back (its path and,
// for a table, every row under its column names and types, which are the format's), so a real name put into any
// table of the tree, and not only the buildouts and the crew, fails the run.
{
  // The format's own words: the tree's folders and file kinds, the generic spawner scripts and templates a row's
  // kind is told by, objvar names, and the enumerations' words.
  const FORMAT = new Set([
    'dsrc', 'sku', 'sys', 'server', 'shared', 'compiled', 'game', 'datatables', 'buildout', 'tab', 'tpf', 'iff', 'mob', 'creatures', 'npc_customization', 'stat_balance', 'ai', 'ai_weapons', 'region', 'spawn_lists', 'npc_lair', 'types', 'spawning', 'ground_spawning', 'dungeon',
    'object', 'tangible', 'mobile', 'building', 'weapon', 'ranged', 'rifle', 'lair', 'base', 'sharedtemplate', 'ep3', 'quest_npc', 'static_npc',
    'area_spawner', 'patrol_spawner', 'patrol_waypoint', 'systems', 'combat', 'spawner_area', 'spawner_patrol', 'npc', 'celebrity', 'celebrity_spawner', 'corpse_spawner', 'theme_park', 'generic_spawner',
    'spawn_table', 'npc_name', 'spawns', 'pointname', 'strspawns', 'intspawncount', 'fltradius', 'intdefaultbehavior', 'fltminspawntime', 'fltmaxspawntime', 'strpatrolpointnames',
    'normal', 'elite', 'boss', 'none', 'no', 'yes', 'herbivore', 'carnivore', 'monster', 'rectangle', 'circle', 'mission', 'spawntrue', 'spawnfalse',
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
      // A table's first two lines are its column names and types: the format's. Everything else is data.
      const texts = [relative(root, p), ...(p.endsWith('.tab') ? lines.slice(2) : lines)];
      for (const t of texts) {
        for (const m of t.toLowerCase().matchAll(word)) {
          const n = m[1].replace(/^(shared|areas|region|dressed_species)_/, '');
          if (!n.startsWith('test_') && !FORMAT.has(n) && n !== 't') stray.add(m[1]);
        }
      }
    }
  };
  read(root);
  ok(stray.size === 0, `every name the tree carries begins test_${stray.size ? `: ${[...stray].join(', ')}` : ''}`);
}

// ------------------------------------------------------------------------------------------ reading
{
  ok(ngeRoots(root)?.kind === 'checkout' && ngeRoots(join(root, 'dsrc'))?.kind === 'dsrc' && ngeRoots(ngeRoots(root)!.server)?.kind === 'datatables' && ngeRoots(tmpdir()) === null, 'the reader takes the checkout, its dsrc or its datatables folder, and nothing else');
  const t = parseTab(tab(['a', 'b', 'c'], ['i[-1]', '"e(x=0,y=1)[x]"', 's[required]'], [['', '1', '']]));
  ok(t.rows[0].a === '-1' && t.rows[0].b === 'y' && t.rows[0].c === '', 'an empty cell takes its column\'s default, an enum written as its number reads as its name, and a required column has none');
  const ov = parseObjvars('test_a|4|test_b|test_c|0|3|$|test_after|4|x');
  ok(ov.get('test_a')?.value === 'test_b' && ov.get('test_c')?.value === '3' && !ov.has('test_after'), 'objvars are name, type and value triples ended by $');
  const reader = makeNgeReader(root)!;
  ok(Number(reader.statAt(25)?.Level) === 20 && Number(reader.statAt(10)?.Level) === 10 && reader.statAt(0) === null, "a level the stat table has no row for takes the nearest row below it, and one below the table's first takes none");
}

// The packs, the snapshot and the catalogue the converter would hand over.
const HUT = 'object/building/test_folder/shared_test_hut.iff';
const DUNGEON = 'object/building/test_folder/shared_test_dungeon.iff';
const cells = [
  { index: 0, name: 'r0' },
  { index: 1, name: 'test_room_a', bounds: { min: [-3, -1, 2], max: [-1, 3, 4] } },
  { index: 2, name: 'test_room_b' },
];
const pack = {
  layout: { objects: [{ template: HUT, x: 1050, z: 2060, model: 'test_hut_model' }, { template: HUT, x: 3050, z: 2060, model: 'test_hut_model' }, { template: DUNGEON, x: 1300, z: 2300, model: 'test_dungeon_model' }, { template: DUNGEON, x: 3300, z: 2300, model: 'test_dungeon_model' }] },
  manifest: { categories: { layout: [{ id: 'test_dungeon_model', cells }] } },
  stamp: 'test_stamp',
};
const HALF = [0, 0, 1, 0];
const snap = mergeBuildouts({ templates: [], nodes: [] }, {
  nodes: [
    { id: 900, containedBy: 0, template: DUNGEON, cellIndex: 0, q: Q_ID, pos: [1300, 0, 2300], radius: 0, portalLayoutCrc: 1 },
    { id: 901, containedBy: 900, template: 'object/cell/shared_cell.iff', cellIndex: 1, q: Q_ID, pos: [0, 0, 0], radius: 0, portalLayoutCrc: 0 },
    { id: 902, containedBy: 900, template: 'object/cell/shared_cell.iff', cellIndex: 2, q: Q_ID, pos: [0, 0, 0], radius: 0, portalLayoutCrc: 0 },
    { id: 910, containedBy: 0, template: DUNGEON, cellIndex: 0, q: HALF, pos: [3300, 0, 2300], radius: 0, portalLayoutCrc: 1 },
    { id: 911, containedBy: 910, template: 'object/cell/shared_cell.iff', cellIndex: 1, q: Q_ID, pos: [0, 0, 0], radius: 0, portalLayoutCrc: 0 },
    { id: 912, containedBy: 910, template: 'object/cell/shared_cell.iff', cellIndex: 2, q: Q_ID, pos: [0, 0, 0], radius: 0, portalLayoutCrc: 0 },
  ],
});
const STATS = { source: 'heuristic', sizeClass: 'small', level: null, hp: 80, damage: 8, reach: 1.5, aggression: 'defensive', ranged: null, attackCooldown: 1.6, tags: [] };
const entry = (id: string, template: string, kind: string) => ({ id, template, kind, ready: true, stats: STATS });
const catalogue = {
  converted: 'test_converted',
  entries: [
    entry('test_body_plain_id', 'object/mobile/test_folder/shared_test_body_plain.iff', 'creature'),
    entry('test_client_body_id', 'object/mobile/test_folder/shared_test_client_body.iff', 'npc'),
    // The plain rule's answer for the template whose `.tpf` names another body: never the one taken.
    entry('test_decoy_id', 'object/mobile/test_folder/shared_test_server_body.iff', 'creature'),
    entry('test_dressed_one_id', 'object/mobile/test_folder/shared_test_dressed_one.iff', 'dressed'),
    entry('test_dressed_two_id', 'object/mobile/test_folder/shared_test_dressed_two.iff', 'dressed'),
    entry('test_body_lair_id', 'object/mobile/test_folder/shared_test_body_lair.iff', 'creature'),
    entry('test_body_crew_id', 'object/mobile/test_folder/shared_test_body_crew.iff', 'npc'),
  ],
};
const entryOf = (id: string) => catalogue.entries.find((e) => e.id === id)!;
const build = (dir: string, zones = ['test_zone']) => {
  const reader = makeNgeReader(dir)!;
  return buildNgeOverlay({ reader, zones, packOf: () => pack, groundOf: () => (x: number) => ground(x), snapOf: () => snap, clientAreas: null, catalogue, converted: 'test_now' });
};
const built = build(root);
const z = built.packs.test_zone;
const rows = z.statics as Record<string, unknown>[];
const zi = built.index.zones.test_zone;

// ------------------------------------------------------------------------------------- the places
{
  ok(zi.copies === 2 && zi.eventAreas === 1, 'the area\'s two copies are read and the event\'s area is left out');
  ok(zi.frame.objects.median === 0 && zi.frame.objects.matched === 4, `the copy's own objects land on the pack's at the corner added, in both copies (median ${zi.frame.objects.median} m over ${zi.frame.objects.matched})`);
  ok(zi.frame.ground.reading === 'snapshot' && zi.frame.ground.asIs < zi.frame.ground.mirrored, `and the spawners sit on the sloping ground as written, not mirrored (${zi.frame.ground.asIs} m as written, ${zi.frame.ground.mirrored} m mirrored)`);
  const fromSpawner = (objid: number, copy: number) => rows.filter((r) => [0, 1, 2, 3].some((i) => r.key === ngeKey('test_zone', 'test_area', copy, objid, i)));
  for (const copy of [0, 1]) {
    const cx = copy === 0 ? 1000 : 3000;
    const drawn = fromSpawner(11, copy);
    ok(drawn.length === 3 && drawn.every((r) => Math.hypot((r.x as number) - (cx + 10), (r.z as number) - 2020) <= 10 + 1e-6 && r.drawn === true), `copy ${copy}: an area spawner of three stands three, each drawn inside its ten-metre disc about the corner added`);
    ok(drawn.every((r) => Math.abs((r.y as number) - Math.round(ground(r.x as number) * 1000) / 1000) < 1e-9) && drawn.some((r) => Math.abs((r.y as number) - on(10)) > 1e-3), `copy ${copy}: each on the ground at its own drawn spot, not at its spawner's height`);
    ok(drawn.every((r) => r.roam === 10 && !r.still), `copy ${copy}: loiter steps about within the disc's radius`);
    const respawns = drawn.map((r) => r.respawn as number);
    ok(respawns.every((v) => v >= 60 && v <= 120.0002) && new Set(respawns).size === respawns.length, `copy ${copy}: each row's respawn is drawn between its spawner's least and most, and two rows draw two (${respawns.join(', ')} s)`);
    const guard = fromSpawner(12, copy);
    ok(guard.length === 1 && guard[0].still === true && guard[0].roam === undefined && guard[0].who === `${NGE_PREFIX}test_creature_plain`, `copy ${copy}: a spawner naming a creature stands it, standing guard still`);
    const knot = fromSpawner(20, copy);
    const lift = on(200) + 25;
    ok(knot.length === 4 && knot.every((r) => Math.abs((r.y as number) - lift) < 1e-9 && r.still === true && !r.drawn) && knot[0].x === cx + 200 && knot[0].z === 2200, `copy ${copy}: a spawner 25 m over the ground stands its four in a knot on itself, at its height, still`);
    ok(knot.slice(1).every((r, i) => Math.abs(Math.hypot((r.x as number) - (cx + 200), (r.z as number) - 2200) - STATIC_TUNE.stackSpread * Math.sqrt(i + 1)) < 0.01 && r.nudged === true), `copy ${copy}: each after the first on the knot's spiral, never across the 30 m disc`);
    const wander = fromSpawner(25, copy);
    ok(wander.length === 2 && wander.every((r) => r.roam === 4 && !r.still), `copy ${copy}: a spawner whose behaviour is not written wanders, the table's own default`);
  }
  ok(spawnerPlace({ x: 0, y: NGE_RULES.lift - 0.01, z: 0, radius: 5 }, 1, 'k', 'k', () => 0).raised === false && spawnerPlace({ x: 0, y: NGE_RULES.lift + 0.01, z: 0, radius: 5 }, 1, 'k', 'k', () => 0).raised === true, `the knot is decided at ${NGE_RULES.lift} m over the ground, the runtime's own perch height`);
  const p = spawnerPlace({ x: 0, y: 0, z: 0, radius: 10 }, 1, 'test_k', 'test_k', () => 0);
  ok(Math.abs(Math.hypot(p.x, p.z) - Math.round(10 * Math.sqrt(unitOf('test_k:r')) * 1000) / 1000) < 2e-3, 'a drawn place is the square root of its draw out across the disc, which spreads a disc\'s people evenly over it');
  const patrols = [...fromSpawner(13, 0), ...fromSpawner(14, 0), ...fromSpawner(13, 1), ...fromSpawner(14, 1)];
  ok(patrols.length === 4 && patrols.every((r) => r.still === true && r.roam === undefined), 'a patrol spawner that stops (behaviour 3) stands its people still between legs');
  const route = fromSpawner(14, 0)[0].route as { x: number; z: number }[];
  ok(route?.length === 2 && route[0].x === 1070 && route[0].z === 2030 && route[1].x === 1080 && fromSpawner(14, 0)[0].walks === true, 'a patrol walks its named points in its own copy, the corner added, and is marked a walker whatever it may be fought');
  ok(!fromSpawner(13, 0)[0].route && !fromSpawner(13, 0)[0].walks && zi.routeLost === 2, 'one naming a point no waypoint has walks nothing, is no walker, and is counted once a copy');
  const statics = rows.filter((r) => r.where === 'static');
  ok(statics.length === 2 && statics.every((r) => Math.abs((r.heading as number) - TURN) < 1e-3 && r.respawn === NGE_RULES.staticRespawn && r.who === `${NGE_PREFIX}test_creature_tpf`), `a static NPC stands at its object, facing its quaternion's yaw (${yawOfQ(Q_TURNED)}), back after ${NGE_RULES.staticRespawn} s`);
  const corpses = rows.filter((r) => r.where === 'corpse');
  ok(corpses.length === 2 && corpses.every((r) => r.mood === 'dead' && r.peaceful === true), 'a corpse lies dead and may not be struck');
  ok(zi.gated === 4 && !rows.some((r) => [1140, 3140, 1150, 3150].includes(r.x as number)) && built.index.gated.area_spawner === 2 && built.index.gated.test_bet_spawner === 2, 'a spawner whose own data names nobody is counted, listed by its own template\'s name and never stood');
  ok(kindOf('object/tangible/spawning/test_folder/test_quest_spawner.iff', ['test_folder.test_quest'], new Map()) === 'gated' && kindOf('object/tangible/test_folder/test_thing.iff', ['test_folder.test_quest_spawner'], new Map()) === 'gated', 'gated is told by shape: a template or a script that is a spawner\'s, with nobody named');
  ok(kindOf('object/building/test_folder/test_dungeon.iff', ['theme_park.dungeon.generic_spawner'], new Map([['spawn_table', { value: 'x' }]])) === 'other' && kindOf('object/tangible/test_folder/test_thing.iff', [], new Map()) === 'other', 'and a building that stands a crew, or a thing that is no spawner, is neither');
  ok(kindOf(AREA, ['systems.spawning.spawner_area', 'test_folder.test_quest_spawner'], new Map([['strSpawns', { value: 'x' }]])) === 'area', 'while a spawner that names who it stands is stood by the data');
  ok(zi.inCell === 2 && !rows.some((r) => (r.x as number) === 1001), 'a spawner in a room is held unplaced, never at a point');
  ok(zi.unresolved === 0 && built.index.unresolved.length === 0 && built.index.bodiless.length === 0, 'every name reaches a creature and every creature a body');
  ok(zi.layout === 'test_stamp', "the index stamps each zone with its pack's layout, which status asks again when it moves");
  ok(z.pools[`${NGE_PREFIX}test_type_a`]?.includes(`${NGE_PREFIX}test_creature_tpf`) && z.pools[`${NGE_PREFIX}test_type_a`]?.includes(`${NGE_PREFIX}test_creature_plain`), 'a type table naming another stands that one\'s creatures too');
}

// ------------------------------------------------------------------------------------- the crews
{
  const crew = rows.filter((r) => r.where === 'dungeon');
  ok(crew.length === 6 && zi.crew === 6 && zi.crewLost === 2 && zi.things === 1, 'a crew stands in every copy of its building: three people a copy, the one in a room the model has not got lost and counted, a crate no person');
  const a = crew.filter((r) => r.room === 1);
  const firsts = a.filter((r) => Math.abs((r.x as number) - 1302) < 1e-6);
  const first = firsts[0];
  const second = a.find((r) => Math.abs((r.x as number) - 3298) < 1e-6);
  ok(firsts.length === 2 && firsts[0].key !== firsts[1].key, 'two rows written exactly alike are two people, each under a name of their own');
  ok(!!first && first.z === 2303 && first.y === 0.5 && first.cell === 901, 'carried out of its room into the snapshot\'s frame through the copy\'s own cell');
  ok(!!second && second.z === 2297 && second.cell === 911 && Math.abs((second.heading as number) + Math.PI / 2) < 1e-3, 'and in the copy turned half round, turned with it, its facing too');
  const local = first?.local as number[];
  const b = cells[1].bounds!;
  const inside = (p: number[]) => p.every((v, i) => v >= Math.min(b.min[i], b.max[i]) && v <= Math.max(b.min[i], b.max[i]));
  ok(!!local && inside([-local[0], local[1], local[2]]) && !inside(local), 'its place is in the room\'s frame as the client keeps it: inside the pack\'s mirrored room only with x negated');
  ok(first?.respawn === 600 && crew.some((r) => !!r.draw && r.room === 2), 'its respawn is the table\'s own, and a row naming a type table draws its person');
}

// ------------------------------------------------------------------------------------- the keys
{
  const again = build(turnedRoot).packs.test_zone.statics as Record<string, unknown>[];
  const sig = (list: Record<string, unknown>[]) => list.map((r) => `${r.key}|${r.who}|${r.x}|${r.z}|${r.room ?? ''}`).sort().join('\n');
  ok(sig(again) === sig(rows), 'every row keeps its key and its place when the tables\' rows come in another order');
  ok(rows.every((r) => /^n[0-9a-f]{11}$/.test(r.key as string)) && !rows.some((r) => /^[0-9a-f]{12}$/.test(r.key as string)), 'every key is n and eleven hex figures, never a Core3 key\'s twelve');
  ok(new Set(rows.map((r) => r.key)).size === rows.length, 'and no two rows share one');
}

// ------------------------------------------------------------------- an area's table with no objid
{
  const reader = makeNgeReader(root)!;
  const table = reader.buildout('test_zone_plain', 'test_area_plain')!;
  ok(table.every((r: { objid: number }) => r.objid === 0) && new Set(rowIds(table)).size === table.length, 'a table that writes no objid names each of its rows by what it says, its twins counted apart');
  const plainBuilt = build(root, ['test_zone_plain']);
  const pr = plainBuilt.packs.test_zone_plain.statics as Record<string, unknown>[];
  ok(pr.length === 9 && new Set(pr.map((r) => r.key)).size === pr.length, `every person of it has a name of their own (${pr.length} rows, ${new Set(pr.map((r) => r.key)).size} names)`);
  // The two spawners three hundred metres apart, each person measured from its own spawner's middle.
  const at = (cx: number, cz: number) => pr.filter((r) => r.where === 'spawner' && Math.hypot((r.x as number) - cx, (r.z as number) - cz) <= 10 + 1e-6).map((r) => `${Math.round(((r.x as number) - cx) * 1000)},${Math.round(((r.z as number) - cz) * 1000)}|${r.respawn}|${r.heading}`).sort();
  const one = at(5100, 5100);
  const two = at(5400, 5100);
  ok(one.length === 2 && two.length === 2 && one.every((s) => !two.includes(s)), 'two spawners of such a table alike in every objvar draw their people at two different offsets, respawns and headings');
  const twins = pr.filter((r) => r.where === 'spawner' && Math.hypot((r.x as number) - 5400, (r.z as number) - 5400) <= 10 + 1e-6);
  ok(twins.length === 4 && new Set(twins.map((r) => `${r.x},${r.z}`)).size === 4, 'and two spawners written exactly alike on one spot stand four people at four places');
  const turned = build(turnedRoot, ['test_zone_plain']).packs.test_zone_plain.statics as Record<string, unknown>[];
  const sig = (list: Record<string, unknown>[]) => list.map((r) => `${r.key}|${r.who}|${r.x}|${r.z}`).sort().join('\n');
  ok(sig(turned) === sig(pr), 'and each keeps its name and place when the table\'s rows come in another order');
}

// ------------------------------------------------------------------------------------- the regions
{
  ok(z.areas.length === 2 && z.areas.every((a: { name: string; groups: string[] }) => a.groups.length === 1 && a.groups[0] === a.name), 'each spawn region with a list of its own name is an area of that one group');
  ok(zi.dropped === 1 && z.noSpawn.length === 1 && z.noSpawn[0].name === `${NGE_PREFIX}test_no_spawn_small`, 'the no-spawn region holding them whole is dropped, the small one kept, and the empty type read as no spawn');
  ok(holdsWhole({ shape: 'circle', x: 0, z: 0, r: 10 }, { shape: 'rect', x: -1, z: -1, x2: 1, z2: 1 }) && !holdsWhole({ shape: 'circle', x: 0, z: 0, r: 1 }, { shape: 'rect', x: -1, z: -1, x2: 1, z2: 1 }), 'a circle holds a rectangle only where it holds its corners');
  const lair = built.manifest.lairs[`${NGE_PREFIX}test_lair_one`];
  ok(lair && lair.building === 'none' && lair.nest === null && lair.kind === 'nge' && lair.cap === 6 && lair.mobiles.length === 2 && lair.mobiles[0].n === 4, 'a lair is a herd with no building, each creature weighted by its limit');
  const g = built.manifest.groups[`${NGE_PREFIX}test_spawn_one`];
  ok(g?.[0].lair === `${NGE_PREFIX}test_lair_one` && g[0].weight === 15 && g[0].size === 25 && g[0].limit === -1, 'and the list\'s row is the group\'s entry, weight, size and limit as written');
  const none = regionAreas([{ regionName: 'test_only', geometry: 'rectangle', minX_or_centerX: 0, minZ_or_centerZ: 0, maxX_or_radius: 10, maxZ: 10, spawnableType: 'spawnTrue' }], new Map(), () => null, () => true);
  ok(none.areas.length === 0, 'a spawn region with no list of its own name stands nothing');
}

// ------------------------------------------------------------------------------------- the creatures
{
  const c = built.manifest.creatures as Record<string, { id: string; game?: Record<string, unknown>; bodies?: string[]; dress?: string[]; weapons?: string[]; attackable: boolean }>;
  ok(Object.keys(c).length === 5 && !c[`${NGE_PREFIX}test_creature_unused`], 'the manifest carries every creature something stands and no other');
  ok(c[`${NGE_PREFIX}test_creature_tpf`].id === 'test_client_body_id', 'a creature whose server template\'s .tpf names its body stands as that body, not the plain rule\'s');
  ok(c[`${NGE_PREFIX}test_creature_dress`].bodies?.length === 2 && c[`${NGE_PREFIX}test_creature_dress`].dress?.[0] === `${NGE_PREFIX}test_dress_list`, 'a dress list\'s name stands as every body in the list');
  // An elite of level 20: 4000 health and 120 a second at three seconds a blow; what the shared curve makes of
  // those is the shared rule's own business (`gameOf`), so the overlay's mapping is held to the record it hands it.
  const tpf = c[`${NGE_PREFIX}test_creature_tpf`].game!;
  const tpfWant = gameOf({ level: 20, ham: [4000, 4000], damage: [360, 360], pvp: ['ATTACKABLE', 'AGGRESSIVE'], creature: ['STALKER', 'KILLER'], weapons: ['object/weapon/ranged/rifle/test_rifle.iff'] }, entryOf('test_client_body_id'))!;
  ok(tpf.level === 20 && tpf.hp === tpfWant.hp && tpf.damage === tpfWant.damage, `gameOf is fed by ngeMob: the elite's stat row at its level, its weapon's speed (${tpf.hp} health, ${tpf.damage} a blow)`);
  ok(tpf.aggression === 'aggressive' && tpf.attackable === true && tpf.killer === true && !!tpf.ranged, 'an aggressive radius is aggressive, a death blow a killer, a rifle a shooter');
  const dress = c[`${NGE_PREFIX}test_creature_dress`].game!;
  const dressWant = gameOf({ level: 30, ham: [20000, 20000], damage: [800, 800], pvp: [], creature: [], weapons: [] }, entryOf('test_dressed_one_id'))!;
  ok(dress.aggression === 'passive' && dress.attackable === false && dress.hp === dressWant.hp && dress.damage === dressWant.damage, 'an invulnerable boss may not be struck and picks no fight, at its class\'s row and the default weapon speed');
  ok(c[`${NGE_PREFIX}test_creature_plain`].game!.aggression === 'defensive', 'and nothing else is aggressive: no radius, no temper');
  ok(c[`${NGE_PREFIX}test_creature_crew`].weapons?.[0] === `${NGE_PREFIX}test_weapon_word` && built.manifest.weaponGroups[`${NGE_PREFIX}test_weapon_word`]?.[0] === 'object/weapon/ranged/rifle/test_rifle.iff', 'a weapon word is a weapon group of its templates');
}

// ------------------------------------------------------------------------------------- the names
{
  const bad: string[] = [];
  const check = (n: unknown, where: string) => {
    if (typeof n !== 'string' || !n.startsWith(NGE_PREFIX)) bad.push(`${where}: ${String(n)}`);
  };
  for (const k of Object.keys(built.manifest.creatures)) check(k, 'creature');
  for (const k of Object.keys(built.manifest.lairs)) check(k, 'lair');
  for (const k of Object.keys(built.manifest.groups)) check(k, 'group');
  for (const k of Object.keys(built.manifest.weaponGroups)) check(k, 'weapon group');
  for (const k of Object.keys(z.pools)) check(k, 'pool');
  for (const a of [...z.areas, ...z.noSpawn]) check(a.name, 'area');
  for (const r of rows) {
    check(r.who, 'row');
    for (const [p] of (r.draw as [string, number][] | undefined) ?? []) check(p, 'draw');
    if (r.src !== 'nge') bad.push(`row not marked: ${r.key}`);
  }
  ok(bad.length === 0, `every name the overlay writes is nge:-prefixed and every row marked src: 'nge'${bad.length ? `: ${bad.slice(0, 5).join(', ')}` : ''}`);
  ok(z.format === 2 && z.planet === 'test_zone' && built.manifest.format === 2 && built.index.format === NGE_FORMAT && built.index.local === true && built.index.copy.files > 10 && /^[0-9a-f]{16}$/.test(built.index.copy.sha1), 'the packs are the spawns format the game reads, and the index says which copy they came from');
  ok(JSON.stringify(build(root).index.copy) === JSON.stringify(built.index.copy), 'and the same copy read again is the same copy');
  // One number of one file changed, and the copy is another copy, whatever its file names.
  const changed = mkdtempSync(join(tmpdir(), 'test_nge_changed_'));
  writeTree(changed);
  const stat = join(changed, 'dsrc', 'sku.0', 'sys.server', 'compiled', 'game', 'datatables', 'mob', 'stat_balance.tab');
  writeFileSync(stat, readFileSync(stat, 'latin1').replace('\t900\t', '\t901\t'), 'latin1');
  const other = build(changed).index.copy;
  ok(other.files === built.index.copy.files && other.sha1 !== built.index.copy.sha1, "a copy with one file's bytes changed is told apart by its hash, not only its file names");
  rmSync(changed, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------- the guards
{
  ok(ngeArg(['spawns', 'test_out', '--nge=@TEST_NGE'])?.refuse?.includes('.env') === true && ngeArg(['spawns', '--nge'])?.refuse !== undefined && ngeArg(['--nge=C:/test_a=b'])?.value === 'C:/test_a=b' && ngeArg(['spawns']) === null, 'the folder is read off the raw word, a path holding = whole, and an @ value refused');
  ok(overlayTarget('test_out', () => 'ignored').dir === 'test_out/nge' && overlayTarget('test_out', () => 'outside').dir !== undefined && overlayTarget('test_out', () => 'tracked').refuse !== undefined && overlayTarget('test_out', () => 'unknown').refuse !== undefined, 'the overlay is written only where git ignores it or no repository holds it');
  ok(sourceInside(join(REPO, 'tools'), REPO) && sourceInside(REPO, REPO) && !sourceInside(root, REPO), 'a copy inside this repository is refused');
  // What git makes of a folder, asked of the repository that really holds it: a fresh repository of its own beside
  // this one, which git from this checkout calls only "outside" this repository.
  ok(gitPlace(join(REPO, 'assets-private', 'nge')) === 'ignored' && gitPlace(join(REPO, 'src', 'nge')) === 'tracked', 'git ignores assets-private/nge, where the overlay goes, and not a folder of the code');
  const other = mkdtempSync(join(tmpdir(), 'test_nge_repo_'));
  const outside = mkdtempSync(join(tmpdir(), 'test_nge_plain_'));
  const inited = spawnSync('git', ['init', '-q', other], { encoding: 'utf8' });
  if (inited.status === 0) {
    writeFileSync(join(other, '.gitignore'), 'test_kept/\n');
    ok(gitPlace(join(other, 'test_code', 'nge')) === 'tracked' && gitPlace(join(other, 'test_kept', 'nge')) === 'ignored', "another repository's own folder is that repository's to ignore or take, never \"outside\"");
  } else console.log('note git init failed here, so the second repository is not tried');
  if (spawnSync('git', ['-C', outside, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).status !== 0) ok(gitPlace(join(outside, 'nge')) === 'outside', 'and a folder no repository holds is outside');
  else console.log('note the temporary folder is inside a repository here, so a folder no repository holds is not tried');
  rmSync(other, { recursive: true, force: true });
  const cli = join(REPO, 'tools', 'swg', 'cli.mjs');
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, SWG: '' } });
  const out = mkdtempSync(join(tmpdir(), 'test_nge_out_'));
  const at = run(['spawns', out, '--nge=@TEST_NGE']);
  ok(at.status === 1 && /never read from \.env/.test(at.stderr), 'the cli refuses an @ value before anything is read');
  const inRepo = run(['spawns', out, `--nge=${join(REPO, 'tools')}`]);
  ok(inRepo.status === 1 && /inside this repository/.test(inRepo.stdout), 'and a copy inside this repository');
  const tracked = run(['spawns', join(REPO, 'src'), `--nge=${root}`]);
  ok(tracked.status === 1 && /not ignored by git/.test(tracked.stdout) && !existsSync(join(REPO, 'src', 'nge')), 'and a target git would take, writing nothing');
  mkdirSync(join(out, 'nge', 'spawns'), { recursive: true });
  writeFileSync(join(out, 'nge', 'index.json'), '{}');
  writeFileSync(join(out, 'nge', 'spawns', 'manifest.json'), '{}');
  const none = run(['spawns', out, '--nge=none']);
  ok(none.status === 0 && /removed .* \(2 files/.test(none.stdout) && !existsSync(join(out, 'nge')), '--nge=none takes the overlay away and says what went');

  // The cli's NGE half, run whole: nothing written outside <out>/nge, the Core3 half's fleet folder left byte for
  // byte, and a zone's pack the last run wrote and this one does not taken away inside nge alone.
  mkdirSync(join(out, 'mobiles'), { recursive: true });
  writeFileSync(join(out, 'mobiles', 'catalogue.json'), JSON.stringify(catalogue));
  mkdirSync(join(out, 'spawns'), { recursive: true });
  const sentinel = '{"test_sentinel":"the Core3 half\'s fleet manifest"}';
  writeFileSync(join(out, 'spawns', 'manifest.json'), sentinel);
  mkdirSync(join(out, 'nge', 'spawns'), { recursive: true });
  writeFileSync(join(out, 'nge', 'spawns', 'test_old_zone.json'), '{}');
  const files = (dir: string, base = dir, list: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) files(p, base, list);
      else list.push(relative(base, p).replace(/\\/g, '/'));
    }
    return list.sort();
  };
  const half = run(['spawns', out, '--core3=none', `--nge=${root}`]);
  ok(half.status === 0 && readFileSync(join(out, 'spawns', 'manifest.json'), 'utf8') === sentinel, `the NGE half leaves the Core3 half's fleet folder exactly as it found it${half.status ? `: ${half.stdout}${half.stderr}` : ''}`);
  ok(files(out).join(',') === 'mobiles/catalogue.json,nge/index.json,nge/spawns/manifest.json,spawns/manifest.json', `and writes nothing but nge/index.json and nge/spawns/manifest.json, a pack of a zone no longer written gone (${files(out).join(', ')})`);
  ok(JSON.parse(readFileSync(join(out, 'nge', 'index.json'), 'utf8')).local === true, 'and its index says it is local');

  // `status`: the overlay's line, and a run asked again by hand alone, never put in the to-do a launcher runs. Its
  // catalogue is the least `status` reads one with.
  writeFileSync(join(out, 'mobiles', 'catalogue.json'), JSON.stringify({ converted: 'test_converted', entries: [], failed: [], options: {} }));
  writeFileSync(join(out, 'nge', 'index.json'), JSON.stringify({ format: NGE_FORMAT, local: true, source: 'nge', converted: 'test_then', copy: { root: 'C:/test_copy' }, catalogue: { converted: 'test_older' }, zones: { test_zone: { rows: 1, areas: 0, layout: 'test_a' } } }));
  const st = run(['status', out, '--json']);
  const said = JSON.parse(st.stdout || '{}') as { steps?: { args: string[] }[]; lines?: string[] };
  ok(st.status === 0 && !!said.steps && said.steps.every((s) => !s.args.some((a) => /--nge/.test(a))) && (said.lines ?? []).some((l) => /nge overlay: run again by hand/.test(l)), 'status says a stale overlay is to be converted again by hand, and puts no --nge in any step a launcher would run');
  rmSync(out, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------- status
{
  const index = { format: NGE_FORMAT, converted: '2026-01-01T00:00:00Z', copy: { root: 'C:/test_copy' }, catalogue: { converted: 'test_cat' }, zones: { test_zone: { rows: 3, areas: 1, layout: 'test_layout' } } };
  ok(ngeStatus(null, {}) === null, 'with no overlay status says nothing at all');
  const fresh = ngeStatus(index, { catalogue: 'test_cat', layouts: { test_zone: 'test_layout' } })!;
  ok(/nge overlay \(local, never shipped\).*3 people, 1 wild areas, from C:\/test_copy/.test(fresh.line) && fresh.ask === null, 'with one, it says what it holds and from where, and asks nothing while it stands for what is there');
  ok(/catalogue/.test(ngeStatus(index, { catalogue: 'test_other', layouts: { test_zone: 'test_layout' } })!.ask!.why) && /--nge=C:\/test_copy/.test(ngeStatus(index, { catalogue: 'test_other', layouts: {} })!.ask!.command), 'a catalogue converted since asks again, with the folder the index recorded');
  ok(/test_zone/.test(ngeStatus(index, { catalogue: 'test_cat', layouts: { test_zone: 'test_moved' } })!.ask!.why) && /older/.test(ngeStatus({ ...index, format: 0 }, { catalogue: 'test_cat', layouts: { test_zone: 'test_layout' } })!.ask!.why), 'and so does a layout that moved, or an overlay of an older format');
  ok(sharedOf('test_folder/test_x') === 'object/mobile/test_folder/shared_test_x.iff' && sharedOf('object/mobile/shared_test_y.iff') === 'object/mobile/shared_test_y.iff', 'a server template\'s shared twin');
}

// The overlay on this machine, where there is one: what the game reads, never what it holds.
{
  const disk = join(REPO, 'assets-private', 'nge', 'spawns', 'manifest.json');
  if (existsSync(disk)) {
    const m = JSON.parse(readFileSync(disk, 'utf8'));
    const stray = [...Object.keys(m.creatures ?? {}), ...Object.keys(m.lairs ?? {}), ...Object.keys(m.groups ?? {}), ...Object.keys(m.weaponGroups ?? {})].filter((k) => !k.startsWith(NGE_PREFIX));
    ok(stray.length === 0 && m.local === true && m.source === 'nge', 'the overlay on this machine names nothing that is not nge:-prefixed');
  } else console.log('note no overlay on this machine (spawns --nge writes one): nothing more to check');
}

rmSync(root, { recursive: true, force: true });
rmSync(turnedRoot, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
