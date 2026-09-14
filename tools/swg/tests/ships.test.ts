// The player ships: which template is which class, and what the build records about interiors.
import assert from 'node:assert/strict';
import { buildShips, shipClassOf, shipLabelOf } from '../ships.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
ok(shipClassOf('object/ship/player/shared_player_xwing.iff') === 'fighter', 'an X-wing is a starfighter');
ok(shipClassOf('object/ship/player/shared_player_ywing.iff') === 'bomber', 'a Y-wing is a bomber');
ok(shipClassOf('object/ship/player/shared_player_yt1300.iff') === 'freighter', 'a YT-1300 is a freighter');
ok(shipClassOf('object/ship/player/shared_player_hutt_medium_s01.iff') === 'gunship', 'a medium Hutt ship is multi-crew');
ok(shipClassOf('object/ship/player/shared_player_sorosuub_luxury_yacht.iff') === 'shuttle', 'a yacht is a shuttle');
ok(shipLabelOf('object/ship/player/shared_player_xwing.iff') === 'xwing', 'the label drops shared_player_');
const log: string[] = [];
const r = buildShips(['object/ship/player/shared_player_xwing.iff', 'object/ship/player/shared_player_yt1300.iff', 'object/ship/player/shared_player_broken.iff'], {
  convert: (t: string) => (t.includes('broken') ? { skip: 'no mesh' } : { model: shipLabelOf(t), file: `${shipLabelOf(t)}.glb`, bounds: { min: [-6, 0, -7], max: [6, 3, t.includes('yt') ? 20 : 6] } }),
  interiorOf: (t: string) => (t.includes('yt1300') ? 'appearance/ship/player/yt1300_interior.pob' : null),
  convertInterior: (_t: string, pob: string) => ({ file: `${pob.replace(/^.*\//, '').replace(/\.pob$/, '')}.glb`, cells: 5 }),
}, { log: (m: string) => log.push(m) });
ok(r.ships.length === 2 && r.skipped.length === 1 && r.skipped[0].why === 'no mesh', 'two ships convert, the broken one is listed with why');
const yt = r.ships.find((s) => s.id === 'yt1300')!;
ok(yt.interior?.cells === 5 && yt.interior.pob.endsWith('.pob'), 'the freighter carries its interior');
ok(r.ships.find((s) => s.id === 'xwing')!.interior === null, 'the fighter has none');
ok(yt.length === 27 && r.ships[0].class <= r.ships[1].class, 'lengths are measured and ships sort by class');
console.log(`${checks} checks passed`);
