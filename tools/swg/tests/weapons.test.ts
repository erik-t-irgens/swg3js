// The weapons rack: which template is which class, and what the build leaves out.
import assert from 'node:assert/strict';
import { weaponClassOf, weaponLabel, weaponLength, buildWeapons } from '../weapons.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
ok(weaponClassOf('object/weapon/ranged/pistol/shared_pistol_dl44.iff').cls === 'pistol', 'a DL-44 is a pistol');
ok(weaponClassOf('object/weapon/ranged/carbine/shared_carbine_e11.iff').cls === 'carbine', 'an E-11 carbine is a carbine');
ok(weaponClassOf('object/weapon/ranged/heavy/shared_heavy_acid_beam.iff').cls === 'heavy', 'an acid beam is a heavy weapon');
ok(weaponClassOf('object/weapon/melee/sword/shared_sword_curved.iff').cls === 'sword1h', 'a curved sword is one-handed');
ok(weaponClassOf('object/weapon/melee/2h_sword/shared_sword_2h_cleaver.iff').cls === 'sword2h', 'a cleaver is two-handed');
ok(weaponClassOf('object/weapon/melee/polearm/shared_lance_staff_metal.iff').cls === 'polearm', 'a lance is a polearm');
ok(weaponClassOf('object/weapon/melee/knife/shared_knife_survival.iff').cls === 'knife', 'a survival knife is a knife');
ok(weaponClassOf('object/weapon/lightsaber/shared_lightsaber_one_handed_gen1.iff').cls === 'lightsaber', 'a lightsaber is a lightsaber');
ok(!!weaponClassOf('object/weapon/ranged/thrown/shared_thrown_grenade_fragmentation.iff').skip, 'a grenade is left out');
ok(!!weaponClassOf('object/weapon/melee/baton/shared_baton_stun.iff').skip, 'a baton is left out, with why');
ok(!!weaponClassOf('object/weapon/ranged/turret/shared_turret_heat.iff').skip, 'a turret is left out');
ok(weaponLabel('object/weapon/ranged/pistol/shared_pistol_dl44.iff') === 'pistol_dl44', 'the label is the file name without shared_');
ok(Math.abs(weaponLength({ min: [-0.05, -0.1, -0.2], max: [0.05, 0.1, 0.9] }) - 1.1) < 1e-9, 'the reach is the longest extent');
const log: string[] = [];
const r = buildWeapons(['object/weapon/ranged/pistol/shared_pistol_dl44.iff', 'object/weapon/melee/polearm/shared_lance_staff_metal.iff', 'object/weapon/melee/baton/shared_baton_stun.iff', 'object/weapon/ranged/rifle/shared_rifle_fail.iff'], {
  convert: (t: string) => (t.includes('fail') ? { skip: 'no mesh' } : { model: weaponLabel(t), file: `${weaponLabel(t)}.glb`, bounds: { min: [0, 0, 0], max: [0.1, 0.1, t.includes('lance') ? 2 : 0.4] } }),
}, { log: (m: string) => log.push(m) });
ok(r.weapons.length === 2 && r.weapons[0].class === 'pistol' && r.weapons[1].class === 'polearm', 'the pistol and the lance are on the rack');
ok(r.weapons[1].length === 2, 'the lance reaches its length');
ok(r.skipped.length === 2 && r.skipped.some((s) => /baton/.test(s.why)) && r.skipped.some((s) => s.why === 'no mesh'), 'the baton and the failed rifle are listed with why');
console.log(`${checks} checks passed`);
