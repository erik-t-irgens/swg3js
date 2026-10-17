// The gallery's sorting and layout, which need no archives.
import assert from 'node:assert/strict';
import { swgAnimCategory, jkaAnimCategory, groupByCategory, layOutRows, labelOf, buildGallery, interiorLayouts, isLiftCell, GALLERY_EXHIBITS, exhibitsFor, engineRearPoint, borrowedHardpoint, sebulbaStatus } from '../gallery.mjs';

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
// A partial build keeps the sections it does not rebuild, and asks for their models to be kept.
const kept: string[] = [];
const g2 = buildGallery({ log: () => {}, only: ['vehicles'], existing: { sections: g.sections, anims: { origin: { x: 0, z: 0 }, swg: { file: 'anims_swg.glb', categories: [] } } } }, {
  convert: (t: string) => ({ model: labelOf(t), radius: 2, height: 1.5 }),
  convertAnims: () => null,
  templates: (prefix: string) => (prefix.startsWith('object/mobile/vehicle') ? ['object/mobile/vehicle/shared_speeder_a.iff'] : []),
  keepModels: (ids: string[]) => kept.push(...ids),
});
ok(g2.sections.map((s: { id: string }) => s.id).join(',') === 'weapons,vehicles,houses', 'a vehicles-only build keeps the weapons and houses from the last one');
ok(kept.includes('pistol_a') && kept.includes('house_a'), 'the kept sections ask for their models');
ok(g2.anims.swg?.file === 'anims_swg.glb', 'the animation grid is kept too');
// The interiors: one exhibit per portal layout, the player houses left to their section, lift cells labelled.
const pobs: Record<string, string> = {
  'object/building/tatooine/shared_cantina.iff': 'appearance/thm_tato_cantina.pob',
  'object/building/naboo/shared_cantina.iff': 'appearance/thm_tato_cantina.pob',
  'object/ship/shared_spacestation_stardestroyer.iff': 'appearance/thm_spc_star_destroyer_s01.pob',
  'object/building/player/shared_house_a.iff': 'appearance/ply_house_a.pob',
};
const cellNames: Record<string, string[]> = { 'appearance/thm_spc_star_destroyer_s01.pob': ['exterior', 'mainhangar', 'elevator00', 'reactorlift'] };
const interiors = interiorLayouts([...Object.keys(pobs), 'object/building/tatooine/shared_no_rooms.iff'], { pobOf: (t: string) => pobs[t] ?? null, cellsOf: (p: string) => cellNames[p] ?? ['exterior', 'room'] });
ok(interiors.length === 2, 'two layouts: the cantina once (shared by two templates), the Star Destroyer; no player house, nothing without rooms');
ok(interiors[0].shared.length === 1 && interiors[0].label === 'cantina', 'the shared layout lists its other templates and is labelled plainly');
ok(interiors[1].lifts.length === 2 && interiors[1].label === 'spacestation_stardestroyer (lifts)', 'lift cells are counted and labelled');
ok(isLiftCell('empelevator') && isLiftCell('reactorlift') && !isLiftCell('hallway01'), 'a lift cell is named for it');
const g3 = buildGallery({ log: () => {}, only: ['interiors'] }, {
  convert: (t: string, appearance?: string) => ({ model: labelOf(appearance ?? t).replace(/\.pob$/, ''), radius: 40, height: 20 }),
  convertAnims: () => null,
  templates: () => [],
  interiors: () => interiors,
});
ok(g3.sections.length === 1 && g3.sections[0].id === 'interiors' && g3.sections[0].items.length === 2, 'the interiors section holds the layouts');
ok(g3.sections[0].items[0].model === 'thm_tato_cantina' && g3.sections[0].items[1].lifts?.length === 2, 'each is converted from its layout file, the lifts carried');

// Exhibits of ours: appended to their section's templates only on a whole run, converted from their own appearance
// with the exhibit handed over, carrying their own rider pose and marked invented.
{
  ok(GALLERY_EXHIBITS.length >= 1 && GALLERY_EXHIBITS.every((e: { invented?: boolean }) => e.invented === true), 'every exhibit of ours says it is ours');
  ok(exhibitsFor('vehicles').length === GALLERY_EXHIBITS.filter((e: { section: string }) => e.section === 'vehicles').length && exhibitsFor('houses').length === 0, "a section's exhibits are its own");
  const seen: { template: string; appearance?: string; exhibit?: unknown }[] = [];
  const deps = {
    convert: (t: string, appearance?: string, exhibit?: unknown) => {
      seen.push({ template: t, appearance, exhibit });
      return { model: labelOf(t), radius: 3, height: 2 };
    },
    convertAnims: () => null,
    templates: (prefix: string) => (prefix.startsWith('object/mobile/vehicle') ? ['object/mobile/vehicle/shared_test_speeder.iff'] : []),
  };
  const whole = buildGallery({ log: () => {}, only: ['vehicles'] }, deps);
  const items = whole.sections[0].items as { template: string; label: string; riderPose?: string; seats?: number; invented?: boolean }[];
  const ex = GALLERY_EXHIBITS[0] as { template: string; appearance: string; label: string; riderPose: string };
  const mine = items.find((i) => i.template === ex.template);
  ok(items.length === 1 + exhibitsFor('vehicles').length && !!mine, "a whole vehicles run appends the exhibits after the archive's templates");
  ok(mine?.label === ex.label && mine?.riderPose === ex.riderPose && mine?.seats === 1 && mine?.invented === true, "an exhibit carries its own label, its own rider pose for one seat, and the mark that it is ours");
  ok(seen.some((s) => s.template === ex.template && s.appearance === ex.appearance && s.exhibit === GALLERY_EXHIBITS[0]), 'and is converted from its own appearance with the exhibit handed to the converter');
  ok(!items.find((i) => i.template === 'object/mobile/vehicle/shared_test_speeder.iff')?.invented, "an archive's own template is never marked ours");
  seen.length = 0;
  const cut = buildGallery({ log: () => {}, only: ['vehicles'], limit: 5 }, deps);
  ok(cut.sections[0].items.length === 1 && !seen.some((s) => s.template === ex.template), 'a run cut to its first few templates (--limit) is those and nothing more');
  const keptRun = buildGallery({ log: () => {}, only: ['houses'], existing: { sections: whole.sections } }, { ...deps, keepModels: () => {} });
  const keptMine = (keptRun.sections.find((s: { id: string }) => s.id === 'vehicles')?.items as { template: string; invented?: boolean; riderPose?: string }[]).find((i) => i.template === ex.template);
  ok(keptMine?.invented === true && keptMine?.riderPose === ex.riderPose, 'a vehicles section kept from the last build keeps the exhibit, its mark and its pose');
}

// The points an exhibit is given: an engine joint's rear middle in the joint's own frame, and a hardpoint borrowed by name.
{
  // Two joints: a root at the origin, and an engine moved 2 m out along x and turned a quarter about y.
  const s = Math.SQRT1_2;
  const joints = [
    { name: 'root', parent: -1 },
    { name: 'lft_engine', parent: 0 },
  ];
  const rest = [
    { rotation: [1, 0, 0, 0], translation: [0, 0, 0] },
    { rotation: [s, 0, s, 0], translation: [2, 0, 0] },
  ];
  // Four vertices on the engine (its box x 1.5..2.5, y 0..1, z -4..-1) and one on the root, all weighted wholly.
  const positions = new Float32Array([1.5, 0, -1, 2.5, 1, -1, 2, 0.5, -4, 2, 0.2, -3, 0, 0, -9]);
  const mgn = {
    transforms: ['root', 'lft_engine'],
    positions,
    weightCounts: [1, 1, 1, 1, 1],
    weightStart: [0, 1, 2, 3, 4],
    weightTransform: [1, 1, 1, 1, 0],
    weightValue: [1, 1, 1, 1, 1],
    hardpoints: [{ name: 'player', parent: 'body', rotation: [1, 0, 0, 0], position: [0.1, 0.2, -0.3] }],
  };
  const hp = engineRearPoint([mgn], joints, rest, 'LFT_ENGINE', 'engine_1');
  ok(hp?.name === 'engine_1' && hp.parent === 'lft_engine', "an engine point is named as asked and hung on the joint, the joint's name matched whatever its case");
  // The rear middle in the model's frame is (2, 0.5, -4); less the joint's place, (0, 0.5, -4); into a frame turned a
  // quarter about y, x' = -z' of the turn's inverse: the point is (4, 0.5, 0) in the joint's own frame.
  const p = hp?.position ?? [NaN, NaN, NaN];
  ok(Math.abs(p[0] - 4) < 1e-6 && Math.abs(p[1] - 0.5) < 1e-6 && Math.abs(p[2]) < 1e-6, 'its place is the rearmost of the joint\'s own vertices and their middle across and up, in the joint\'s frame');
  ok(hp?.rotation.join() === '1,0,0,0', 'with no turn of its own');
  ok(engineRearPoint([mgn], joints, rest, 'rght_engine', 'engine_2') === null, 'a joint the skeleton has not got gives no point');
  const noVerts = engineRearPoint([{ ...mgn, weightTransform: [0, 0, 0, 0, 0] }], joints, rest, 'lft_engine', 'engine_1');
  ok(noVerts === null, 'nor does a joint no vertex is weighted to');
  const borrowed = borrowedHardpoint([mgn], 'PLAYER');
  ok(borrowed?.name === 'player' && borrowed.parent === 'body' && borrowed.position.join() === '0.1,0.2,-0.3', 'a hardpoint is borrowed by name, whatever its case, with its joint and place');
  if (borrowed) borrowed.position[0] = 99;
  ok(mgn.hardpoints[0].position[0] === 0.1, 'as a copy, so the mesh it came from is left as it was');
  ok(borrowedHardpoint([mgn], 'saddle') === null, 'and a name the mesh has not got gives none');
}

// Whether `status` asks for the vehicles again for Sebulba's pod: only while the gallery lists Anakin's and not his.
{
  const index = (...labels: string[]) => ({ sections: [{ id: 'vehicles', items: labels.map((label) => ({ label })) }] });
  ok(sebulbaStatus(index('podracer_anakin', 'speederbike')).stale === true, "a gallery with Anakin's pod and not Sebulba's is asked for again");
  ok(sebulbaStatus(index('podracer_anakin', 'podracer_sebulba')).stale === false, 'one with both is not');
  ok(sebulbaStatus(index('speederbike')).stale === false, "nor one with neither, whose archives may stop before the pods' own");
  ok(sebulbaStatus(null).stale === false && sebulbaStatus({ sections: [] }).stale === false, 'nor no gallery at all');
}
console.log(`${checks} checks passed`);
