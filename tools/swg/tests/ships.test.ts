// The player ships: which template is which class, what the build records about interiors, which
// gun a ship fires, how far a bolt's effect reaches, and what the client data says of the wings.
import assert from 'node:assert/strict';
import { boltReach, buildShips, defaultWeaponFor, shipClassOf, shipLabelOf } from '../ships.mjs';
import { parseClientData, parseClientEffect } from '../shipdata.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';

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

// The gun a ship fires, from the weapon table's names.
const guns = ['wpn_generic', 'wpn_xwing_missile_s01', 'wpn_awing_blaster', 'wpn_tiefighter_basic', 'wpn_tieadvanced_blaster', 'wpn_z95_blaster', 'wpn_light_blaster', 'wpn_light_blaster_green'];
ok(defaultWeaponFor('awing', guns) === 'wpn_awing_blaster', 'an A-wing fires its own blaster');
ok(defaultWeaponFor('tiefighter', guns) === 'wpn_tiefighter_basic' && defaultWeaponFor('tie_advanced', guns) === 'wpn_tieadvanced_blaster', 'the TIEs fire theirs, named without the underscore');
ok(defaultWeaponFor('xwing', guns) === 'wpn_light_blaster', 'an X-wing has only a missile of its own, so it fires the light blaster');
ok(defaultWeaponFor('tie_bomber', guns) === 'wpn_light_blaster_green' && defaultWeaponFor('lambda_shuttle', guns) === 'wpn_light_blaster_green', "the Empire's ships fire green");
ok(defaultWeaponFor('ywing', ['wpn_generic']) === 'wpn_generic', 'the generic gun when nothing else fits');

// A bolt's reach: the emitter's forward offset plus the quad's half length, the furthest emitter.
const wf = (v: number) => ({ points: [[0, v, 0, 0], [1, v, 0, 0]] });
const bolt = { scale: 1, groups: [{ emitters: [{ translationZ: wf(9), particle: { quad: { length: wf(9) } } }, { translationZ: wf(9), particle: { quad: { length: wf(10) } } }, { translationZ: wf(0), particle: {} }] }] };
ok(boltReach(bolt) === 19, 'a space bolt reaches 19 m ahead of its projectile');

// The client data's wing entry: template, open angle, seconds to open, the sound, and the hinge.
const wingData = new W().str('object/tangible/ship/attachment/wing/shared_xwing_wing_pos_s01.iff').f32(-14).f32(3).str('@@sound/wings_open_xwing.snd').bytes();
const hinge = new W().f32(1).f32(2).f32(3).f32(0).f32(0).f32(90).bytes();
const cdf = parseClientData(parseIff(Buffer.from(encode(form('CLDF', form('0000', form('WING', chunk('DATA', wingData), chunk('PSOR', hinge))))))));
ok(cdf.wings.length === 1 && cdf.wings[0].angle === -14 && cdf.wings[0].time === 3, 'a wing opens by its angle over its seconds');
ok(cdf.wings[0].sounds[0] === 'sound/wings_open_xwing.snd' && cdf.wings[0].hinge!.join(',') === '1,2,3,0,0,90', 'the sound loses its @@ and the hinge is read whole');
ok(cdf.wings[0].template.endsWith('shared_xwing_wing_pos_s01.iff'), 'the wing template is read before the numbers');

// A client effect: the particle effect and the sound among its chunks, whatever their tags.
const cef = parseClientEffect(parseIff(Buffer.from(encode(form('CLEF', form('0001', chunk('PSND', new W().str('sound/shp_hit_armor.snd').bytes()), chunk('PRTC', new W().str('appearance/pt_explosion_ship_armor.prt').f32(1).bytes())))))));
ok(cef.particles[0] === 'appearance/pt_explosion_ship_armor.prt' && cef.sounds[0] === 'sound/shp_hit_armor.snd', 'a hit effect names its particle effect and its sound');
console.log(`${checks} checks passed`);
