// The gallery's sorting and layout, which need no archives.
import assert from 'node:assert/strict';
import { swgAnimCategory, jkaAnimCategory, groupByCategory, layOutRows, labelOf, buildGallery } from '../gallery.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
ok(swgAnimCategory('loop_pistol_standing:speed1') === 'Pistol', 'a pistol loop sorts under Pistol');
ok(swgAnimCategory('loop_rifle:speed2') === 'Rifle & carbine', 'a rifle loop under Rifle & carbine');
ok(swgAnimCategory('sword_1h_standing_ready_hrz_slash_middle_r') === 'One-hand melee', 'a one-hand sword swing under One-hand melee');
ok(swgAnimCategory('pole_standing_ready_combo_2a') === 'Polearm', 'a pole combo under Polearm');
ok(swgAnimCategory('loop_walk') === 'Locomotion & postures', 'a walk under Locomotion');
ok(swgAnimCategory('emt_rifle_ambient_01') === 'Rifle & carbine', 'a rifle emote stays with the rifle');
ok(swgAnimCategory('trn_stand_to_incapacitated') === 'Transitions', 'a transition under Transitions');
ok(swgAnimCategory('rea_stand_get_hit_light') === 'Reactions', 'a reaction under Reactions');
ok(jkaAnimCategory('BOTH_A2_T__B_') === 'Saber style 2: swings, wind-ups, returns, arcs, bounces', 'a medium swing under its style');
ok(jkaAnimCategory('BOTH_T7_BL_BR') === 'Saber style 7: swings, wind-ups, returns, arcs, bounces', 'a staff arc under its style');
ok(jkaAnimCategory('BOTH_A6_SABERPROTECT') === 'Saber specials & katas', 'the dual kata under specials');
ok(jkaAnimCategory('BOTH_P1_S1_TR') === 'Parries & blocks', 'a parry under parries');
ok(jkaAnimCategory('BOTH_SABERFAST_STANCE') === 'Stances & idles', 'a stance under stances');
ok(jkaAnimCategory('BOTH_FORCEJUMPLEFT1') === 'Jumps, rolls, wall moves', 'a force jump under jumps');
ok(jkaAnimCategory('BOTH_RUNBACK2') === 'Locomotion', 'a back-pedal under locomotion');
ok(jkaAnimCategory('TORSO_WEAPONREADY3') === 'Torso only (weapons)', 'a torso clip under torso');
const groups = groupByCategory([{ name: 'BOTH_A2_T__B_' }, { name: 'BOTH_A1_T__B_' }, { name: 'BOTH_STAND2' }], jkaAnimCategory);
ok(groups.length === 3 && groups[0].category.startsWith('Saber style 1') && groups[1].category.startsWith('Saber style 2') && groups[2].category === 'Stances & idles', 'categories come out in a stable order');
const rows = layOutRows([{ radius: 2 }, { radius: 3 }, { radius: 10 }, { radius: 1 }], { rowWidth: 30, gap: 2, startZ: 100 });
ok(rows.placed[0].x === 3 && rows.placed[0].z === 103, 'the first exhibit sits a gap in from the row start');
ok(rows.placed[1].x === 6 + 3 + 1, 'the next stands beside it with a gap between');
ok(rows.placed[2].z > rows.placed[1].z, 'a wide exhibit that would overrun the row width starts a new row');
ok(rows.depth > 20, 'the section depth covers every row');
ok(labelOf('object/building/player/shared_player_house_tatooine_small_style_01.iff') === 'player_house_tatooine_small_style_01', 'a label is the template name without shared_');
// buildGallery with stub conversions: sections one after another, weapons floating at their height.
const log: string[] = [];
const g = buildGallery({ log: (m: string) => log.push(m), only: ['weapons', 'houses'] }, {
  convert: (t: string) => (t.includes('skip') ? { skip: 'no' } : { model: labelOf(t), radius: t.includes('house') ? 12 : 0.6, height: 1 }),
  convertAnims: () => null,
  templates: (prefix: string) => (prefix.startsWith('object/weapon') ? ['object/weapon/ranged/shared_pistol_a.iff', 'object/weapon/melee/shared_skip_me.iff'] : ['object/building/player/shared_house_a.iff', 'object/building/player/shared_house_b.iff']),
});
ok(g.sections.length === 2 && g.sections[0].id === 'weapons' && g.sections[1].id === 'houses', 'weapons then houses');
ok(g.objects.length === 3 && g.objects[0].y === 1.1 && g.objects[1].y === 0, 'weapons float at display height, houses stand on the ground');
ok(g.sections[1].z > g.sections[0].z + g.sections[0].depth, 'the houses start beyond the weapons');
ok(g.objects.every((o: { q: number[] }) => o.q.length === 4), 'every exhibit carries a rotation');
console.log(`${checks} checks passed`);
