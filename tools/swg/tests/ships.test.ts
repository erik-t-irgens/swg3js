// The player ships: which template is which class, what the build records about interiors, which
// gun a ship fires, how far a bolt's effect reaches, and what the client data says of the wings.
import assert from 'node:assert/strict';
import { boltReach, buildShips, defaultWeaponFor, shipClassOf, shipLabelOf } from '../ships.mjs';
import { parseClientData, parseClientEffect } from '../shipdata.mjs';
import { parseIff } from '../iff.mjs';
import { chunk, encode, form, W } from './iffWriter.ts';
import { atBase, traceHash } from './atBase.ts';

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

// With the chassis table read, a player template with no chassis row is a placeholder (on SOE's final mount the TIE
// Defender one, drawn on an X-wing body): left out, listed with why, and never converted.
{
  const converted: string[] = [];
  const s = buildShips(['object/ship/player/shared_player_xwing.iff', 'object/ship/player/shared_player_tie_defender.iff'], {
    convert: (t: string) => (converted.push(t), { model: shipLabelOf(t), file: `${shipLabelOf(t)}.glb`, bounds: { min: [-1, 0, -1], max: [1, 1, 1] } }),
    chassisOf: (t: string) => (t.includes('tie_defender') ? null : 'player_xwing'),
  });
  ok(s.ships.length === 1 && s.skipped.length === 1 && /no chassis row/.test(s.skipped[0].why) && !converted.some((t) => t.includes('tie_defender')), 'a template with no chassis row is left out, listed with why, and not converted');
  const noTable = buildShips(['object/ship/player/shared_player_tie_defender.iff'], { convert: (t: string) => ({ model: shipLabelOf(t), file: 'x.glb', bounds: { min: [0, 0, 0], max: [1, 1, 1] } }) });
  ok(noTable.ships.length === 1, 'with no chassis table read nothing is left out for it');
}
// The fighters SOE's last publishes added, by the four words of ours.
ok(['twing', 'havoc', 'snow_speeder_s01', 'snowspeeder', 'droid_fighter_s01'].every((n) => shipClassOf(`object/ship/player/shared_player_${n}.iff`) === 'fighter'), 'the T-wing, the Havoc, the snowspeeder and the droid fighter are starfighters');
{
  // Day one: every name the old rule classed keeps its class, unless it now matches one of the four words.
  const old = await atBase<{ shipClassOf: typeof shipClassOf }>('tools/swg/ships.mjs');
  const names = ['xwing', 'ywing', 'awing', 'bwing', 'z95', 'tiefighter', 'tie_bomber', 'tieadvanced', 'tieinterceptor', 'tie_defender', 'tiedefender', 'tieoppressor', 'yt1300', 'yt2400', 'ykl37r', 'firespray', 'decimator', 'arc170', 'hutt_heavy_s01', 'hutt_medium_s02', 'hutt_light_s01', 'blacksun_heavy_s01', 'blacksun_light_s02', 'blacksun_vaksai_s02', 'kimogila', 'jedi_starfighter', 'naboo_n1', 'vwing', 'sorosuub_luxury_yacht', 'lambda', 'corellian_corvette', 'gunboat', 'g1a', 'belbullab22', 'scyk', 'headhunter', 'ixiyen', 'rihkxyrk', 'twing', 'havoc', 'snow_speeder_s01', 'droid_fighter_s01', 'eta2', 'delta7'];
  const NEW = /twing|havoc|snow_?speeder|droid_fighter/;
  // Where git cannot hand the base over, today's classes of the names the four words do not name are held to the hash
  // of the base's, written down here.
  const kept = names.filter((n) => !NEW.test(n));
  const trace = (f: typeof shipClassOf) => kept.map((n) => [n, f(`object/ship/player/shared_player_${n}.iff`)]);
  const BASE_TRACE = 'ff30dc4cb21c';
  if (old) {
    const moved = names.filter((n) => { const t = `object/ship/player/shared_player_${n}.iff`; return shipClassOf(t) !== old.shipClassOf(t) && !NEW.test(t); });
    ok(!moved.length, `day one: every name keeps the class the rule gave it at the pass's base, but those the four words now name (${names.length} names${moved.length ? `; moved ${moved.join(', ')}` : ''})`);
    const then = traceHash(trace(old.shipClassOf));
    if (then !== BASE_TRACE) console.log(`note the base's trace hashes to ${then}; write it as BASE_TRACE so a checkout without git still holds today's to it`);
    else ok(true, `and that trace is the one written down here (${BASE_TRACE})`);
  } else {
    console.log("note git cannot hand over ships.mjs as it stood at the pass's base: today's classes are held to the trace written down here");
    ok(traceHash(trace(shipClassOf)) === BASE_TRACE, `day one: every name the four words do not name keeps the base's class (${traceHash(trace(shipClassOf))}, written ${BASE_TRACE})`);
  }
}

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
