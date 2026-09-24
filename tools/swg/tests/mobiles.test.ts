// The mobiles converter's rules, on synthetic data: ids, classification, template parameters,
// the path-keeping flattener and the branch a wild spawn plays, pack planning and baking, names,
// customization, outfits, stats, unit records, selection and the catalogue. No archive is read.
import assert from 'node:assert/strict';
import { form, chunk, W, encode, type Node } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { buildGlb } from '../glb.mjs';
import { parseSkeleton, skinData } from '../skeletal.mjs';
import { loadShader, renderContext } from '../texrender.mjs';
import { core3MobileStats, parseCore3Mobiles } from '../spawns.mjs';
import { shaderVariableNames } from '../mobilescan.mjs';
import * as M from '../mobiles.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

// ---------------------------------------------------------------------------------------------
// Fixtures

const pxat = (file: string) => form('PXAT', form('0000', chunk('INFO', new W().str(file).bytes())));
const spat = (...children: Node[]) => form('SPAT', form('0000', ...children));
const tscl = (scale: number, child: Node) => form('TSCL', form('0000', chunk('INFO', new W().f32(scale).bytes()), child));
const ywat = (none: Node, neg: Node, pos: Node) => form('YWAT', form('0000', form('NONE', none), form('YNEG', neg), form('YPOS', pos)));
const ssat = (variable: string, branches: Node[], values: [string, number][], dflt: number) => {
  const w = new W().i16(values.length);
  for (const [value, index] of values) w.str(value).i16(index);
  return form('SSAT', form('0000', chunk('INFO', new W().str(variable).bytes()), form('ANMS', ...branches), chunk('VAL ', w.bytes()), chunk('DFLT', new W().i16(dflt).bytes())));
};
const lat = (hierarchy: string, entries: [string, Node | null][]) =>
  form('LATT', form('0001', chunk('INFO', new W().str(`appearance/ash/${hierarchy}.ash`).i16(entries.length).bytes()),
    ...entries.map(([name, template]) => form('ANIM', chunk('INFO', new W().str(name).bytes(), ), ...(template ? [template] : [])))));
const cssi = (name: string, value: number) => chunk('CSSI', new W().str(name).i32(value).bytes());
const wcsi = (name: string, value: number) => chunk('WCSI', new W().str(name).i32(value).bytes());
const mesh = (path: string) => chunk('MESH', new W().str(path).bytes());
const wear = (...children: Node[]) => form('WEAR', ...children);
const cldf = (...children: Node[]) => form('CLDF', form('0000', ...children));
const tx1d = (tag: string, files: number, variable: string) => chunk('TX1D', new W().u32(tagNumber(tag)).i16(0).i16(files).str(variable).u8(1).i16(0).bytes());
const pal = (variable: string, tag: string, palette: string) => chunk('PAL ', new W().str(variable).u8(1).u32(tagNumber(tag)).str(palette).i32(0).bytes());
function tagNumber(tag: string) {
  return ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0;
}
const cshd = (choices: Node[], palettes: Node[], files: string[] = ['texture/a.dds', 'texture/b.dds']) => {
  const data = new W().i16(files.length);
  for (const f of files) data.str(f);
  return form('CSHD', form('0001',
    form('SSHT', form('0000')),
    form('TXTR', chunk('DATA', data.bytes()), form('CUST', ...choices)),
    form('TFAC', ...palettes)));
};
const q = (w: number, x: number, y: number, z: number) => new W().f32(w).f32(x).f32(y).f32(z);
/** The two-joint skeleton of skeletal.test.ts, with the joint names spelled as asked. */
const skeleton2 = (names = ['root', 'child']) => parseSkeleton(parseIff(Buffer.from(encode(form('SKTM', form('0002',
  chunk('INFO', new W().i32(2).bytes()),
  chunk('NAME', new W().str(names[0]).str(names[1]).bytes()),
  chunk('PRNT', new W().i32(-1).i32(0).bytes()),
  chunk('RPRE', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
  chunk('RPST', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
  chunk('BPTR', new W().f32(0).f32(0).f32(0).f32(0).f32(1).f32(0).bytes()),
  chunk('BPRO', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
  chunk('JROR', new W().u32(0).u32(0).bytes())))))));
/** A keyframe animation of `frames` frames at 30 fps: the child turns, the root holds still. */
const anim = (frames: number, names = ['root', 'child']) => {
  const rot = new W().i32(frames);
  for (let f = 0; f < frames; f++) rot.i32(f).f32(1).f32(0).f32(f / (frames * 4)).f32(0);
  return {
    version: 3, fps: 30, frameCount: frames,
    transforms: [
      { name: names[0], animatedRotation: false, rotationIndex: 0, translationMask: 0, xIndex: 0, yIndex: 0, zIndex: 0 },
      { name: names[1], animatedRotation: true, rotationIndex: 0, translationMask: 0, xIndex: 0, yIndex: 0, zIndex: 0 },
    ],
    rotationChannels: [Array.from({ length: frames }, (_, f) => ({ frame: f, q: [1, 0, f / (frames * 4), 0] }))],
    staticRotations: [[1, 0, 0, 0]],
    translationChannels: [],
    staticTranslations: [0, 0, 0],
    locomotionSpeed: 0,
  };
};
/** A vfs over a map of encoded buffers. */
const fakeVfs = (files: Map<string, Uint8Array>) => ({
  has: (p: string) => files.has(p.toLowerCase()),
  read: (p: string) => Buffer.from(files.get(p.toLowerCase())!),
  list: (prefix = '') => [...files.keys()].filter((k) => k.includes(prefix)).sort(),
});

// ---------------------------------------------------------------------------------------------
// 1-5. Ids and classification

ok(M.entryIdOf('object/mobile/ep3/shared_ep3_forest_kkorrwrot.iff') === 'ep3/ep3_forest_kkorrwrot' && M.entryIdOf('object/mobile/shared_rancor.iff') === 'rancor', 'an entry id keeps its folder and drops shared_');
const packId = (table: string, skeletons: [string, string][]) => M.packIdOf(M.packKeyOf(table, skeletons.map(([file, attachTo]) => ({ file, attachTo }))));
ok(packId('appearance/lat/rancor.lat', [['appearance/skeleton/rancor.skt', '']]) === 'rancor', 'a pack of one skeleton named after its table is just that name');
ok(packId('appearance/lat/elite_acklay.lat', [['appearance/skeleton/acklay.skt', '']]) === 'elite_acklay-acklay', 'a table on another skeleton names both');
ok(packId('appearance/lat/all_m.lat', [['appearance/skeleton/all_b.skt', ''], ['appearance/skeleton/hum_m_face.skt', 'head']]) === 'all_m-all_b-hum_m_face', 'a face rig at the head is named without its joint');
ok(packId('appearance/lat/ito.lat', [['appearance/skeleton/ito.skt', ''], ['appearance/skeleton/ito_panel.skt', 'spine_1']]) === 'ito-ito-ito_panel_at_spine_1', 'a skeleton hung anywhere but the head names its joint');
ok(/^distant_ship_controller-[a-z0-9_]+-13x-[0-9a-f]{8}$/.test(packId('appearance/lat/distant_ship_controller.lat', Array.from({ length: 13 }, (_, i) => [`appearance/skeleton/ship_${i}.skt`, ''] as [string, string]))), 'a long skeleton list is hashed instead');
ok(M.exclusionOf({ folder: 'skeleton', appearance: 'appearance/x.sat' }) === 'skeleton base template'
  && M.exclusionOf({ folder: 'vehicle/speeder', appearance: 'appearance/x.sat' }) === 'vehicle'
  && M.exclusionOf({ folder: '', appearance: null }) === 'no appearance'
  && M.exclusionOf({ folder: '', appearance: 'appearance/x.apt' }) === 'not skeletal (.apt)'
  && M.exclusionOf({ folder: '', appearance: 'appearance/x.sat', appearanceExists: false }) === 'appearance missing from the archives'
  && M.exclusionOf({ folder: '', appearance: 'appearance/pv_x.sat', table: 'appearance/lat/monstrosity.lat' }) === 'not a creature'
  && M.exclusionOf({ folder: '', appearance: 'appearance/rancor.sat', table: 'appearance/lat/rancor.lat', appearanceId: 'rancor' }) === null, 'every exclusion has its reason, and a creature has none');
ok(M.kindOf({ playerBody: 'human_male', hierarchy: 'all_b', table: 'all_m' }) === 'dressed'
  && M.kindOf({ hierarchy: 'creature_base', table: 'rancor' }) === 'creature'
  && M.kindOf({ hierarchy: 'creature_base', table: 'basilisk_war_droid' }) === 'droid'
  && M.kindOf({ hierarchy: 'all_b', table: 'jawa' }) === 'npc'
  && M.kindOf({ hierarchy: 'creature_base', table: 'sarlacc' }) === 'special'
  && M.kindOf({ hierarchy: 'all_b', table: 'astromech' }) === 'droid', 'the five kinds come from the body, the table and the hierarchy');
ok(M.genderOf({ templateGender: 1, appearanceId: 'leia' }) === 'f'
  && M.genderOf({ templateGender: 0, appearanceId: 'aqualish_f_01' }) === 'f'
  && M.genderOf({ templateGender: 0, appearanceId: 'pgc_chiss_m_costume', faceRig: 'appearance/skeleton/hum_f_face.skt' }) === 'm'
  && M.genderOf({ templateGender: 0, appearanceId: 'rancor', hierarchy: 'creature_base' }) === null, 'gender comes from the template flag, then the appearance name, then the face rig');

// ---------------------------------------------------------------------------------------------
// 6-8. Template parameters, in the bytes the templates really carry

const numberParam = (type: number, ...rest: number[]) => Buffer.from([type, 0x20, ...rest]);
const f32 = (v: number) => [...new Uint8Array(Float32Array.of(v).buffer)];
const i32 = (v: number) => [...new Uint8Array(Int32Array.of(v).buffer)];
ok(near(M.decodeNumberParam(numberParam(1, ...f32(2.2)))!, 2.2, 1e-6)
  && M.decodeNumberParam(numberParam(1, ...i32(1)), false) === 1
  && JSON.stringify(M.decodeNumberParam(numberParam(3, ...f32(1.12), ...f32(1.12)))) === '[1.1200000047683716,1.1200000047683716]'
  && M.decodeNumberParam(numberParam(0)) === undefined
  && M.decodeNumberParam(numberParam(1, 0)) === undefined
  && M.decodeNumberParam(numberParam(3, ...f32(1))) === undefined
  && M.decodeNumberParam(Buffer.alloc(0)) === undefined
  && M.decodeNumberParam(numberParam(2, ...f32(1), ...f32(2))) === undefined, 'a number parameter reads single values and ranges, and never past its buffer');
const array = (...parts: number[][]) => Buffer.from([...i32(parts.length), ...parts.flat()]);
ok(JSON.stringify(M.decodeFloatArray(array([1, 0x20, ...f32(7)], [0, 0x20]))) === '[7,null]'
  && JSON.stringify(M.decodeFloatArray(array([0, 0x20], [1, 0x20, ...f32(2)]))) === '[null,2]'
  && M.decodeFloatArray(array([0, 0x20], [0, 0x20])) === undefined, 'an array parameter reads round an unset element');
const filled = M.resolveParams({ speed: [7.01, null], scale: 2, collisionRadius: undefined });
ok(filled.move.run === 7.01 && filled.move.walk === 7.01 && filled.size.scale[0] === 2 && filled.size.collisionRadius === 0.5 && filled.move.turnRun === 300, 'an unset element takes its neighbour, and the class default only when both are unset');
const stringId = (table: string | null, key: string | null) => {
  const w = new W().u8(1);
  for (const part of [table, key]) {
    if (part === null) w.u8(0);
    else w.u8(1).str(part);
  }
  return Buffer.from(w.bytes());
};
ok(JSON.stringify(M.decodeStringId(stringId('npc_name', 'stormtrooper'))) === '{"table":"npc_name","key":"stormtrooper"}'
  && M.decodeStringId(stringId('npc_name', ''))!.key === ''
  && M.decodeStringId(Buffer.from([0])) === undefined
  && M.decodeStringId(Buffer.from([1, 1, 0x6e, 0x70, 0x63])) === undefined, 'a string id reads its table and key, and an empty key counts as set');

// ---------------------------------------------------------------------------------------------
// 9-12. Flattening and the branch a wild spawn plays

const moods = (calm: string, bored: string) => ssat('mood', [pxat(calm), pxat(bored)], [['calm', 0], ['default', 0], ['bored', 1]], 0);
const mounted = lat('creature_base', [['loop_stand', ssat('mounted_creature',
  [spat(pxat('b_run_mount'), moods('b_idle_calm_mount', 'b_idle_bored_mount')), spat(pxat('b_run'), moods('b_idle_calm', 'b_idle_bored'))],
  [['1', 0], ['default', 0], ['0', 1]], 0)]]);
const mountedTable = M.tableNames(parseIff(Buffer.from(encode(mounted))));
const mountedLeaves = M.chooseLeaves(mountedTable.names.get('loop_stand'));
ok(mountedTable.hierarchy === 'creature_base' && mountedLeaves.length === 2
  && mountedLeaves[0].file === 'appearance/animation/b_run.ans' && mountedLeaves[1].file === 'appearance/animation/b_idle_calm.ans',
'the wild, calm branch is chosen through two nested selectors');
ok(mountedLeaves[1].path.some((s: any) => s.k === 'sel' && s.variable === 'mounted_creature') && mountedLeaves[1].path.some((s: any) => s.k === 'sel' && s.variable === 'mood'), 'a leaf keeps every selector step that reaches it');
const genderTable = M.tableNames(parseIff(Buffer.from(encode(lat('all_b', [['loop_standing', ssat('gender',
  [spat(pxat('idle_n'), pxat('walk')), spat(pxat('idle_c'), pxat('walk'))], [['o', 0], ['m', 0], ['f', 1]], -1)]])))));
const male = M.chooseLeaves(genderTable.names.get('loop_standing'));
const female = M.chooseLeaves(genderTable.names.get('loop_standing'), { female: true });
ok(male[0].file.endsWith('idle_n.ans') && female[0].file.endsWith('idle_c.ans') && male[1].file === female[1].file, 'each gender takes its own idle and they share the walk');
const yawTable = M.tableNames(parseIff(Buffer.from(encode(lat('creature_base', [['loop_stand', ywat(pxat('stand'), pxat('turn_l'), pxat('turn_r'))]])))));
ok(M.chooseLeaves(yawTable.names.get('loop_stand'))[0].file.endsWith('stand.ans'), 'the straight-ahead yaw branch wins');
const scaled = M.tableNames(parseIff(Buffer.from(encode(lat('creature_base', [['attack', tscl(2.5, pxat('atk'))], ['empty', null]])))));
ok(scaled.names.get('attack')![0].timeScale === 2.5 && !scaled.names.has('empty'), 'a time scale rides on the leaf, and a name with no animation template is not in the table');

// ---------------------------------------------------------------------------------------------
// 13-15. Pack planning

const headers: Record<string, any> = {
  'appearance/animation/run.ans': { frames: 40, fps: 30, speed: 3.47, transforms: ['root', 'child'], animatedRotations: 2, animatedTranslations: 0, offsetTranslations: 0 },
  'appearance/animation/walk.ans': { frames: 50, fps: 30, speed: 0.86, transforms: ['root', 'child'], animatedRotations: 2, animatedTranslations: 0, offsetTranslations: 0 },
  'appearance/animation/idle.ans': { frames: 100, fps: 30, speed: 0, transforms: ['root', 'child'], animatedRotations: 2, animatedTranslations: 0, offsetTranslations: 0 },
  'appearance/animation/hit.ans': { frames: 30, fps: 30, speed: 0, transforms: ['root', 'child'], animatedRotations: 2, animatedTranslations: 0, offsetTranslations: 0 },
  'appearance/animation/shot.ans': { frames: 1, fps: 0, speed: 0, transforms: ['root', 'child'], animatedRotations: 2, animatedTranslations: 0, offsetTranslations: 0 },
};
const header = (file: string) => headers[file] ?? null;
const planOf = (entries: [string, Node | null][], hierarchy = 'creature_base', joints = 2) => {
  const table = M.tableNames(parseIff(Buffer.from(encode(lat(hierarchy, entries)))));
  return M.planPack({ id: 'test', key: 'k', table: 'appearance/lat/test.lat', hierarchy: table.hierarchy, joints, names: table.names, genders: false }, { header });
};
const shared = planOf([['loop_stand', spat(pxat('run'), pxat('walk'), pxat('idle'))], ['loop_stand_combat', spat(pxat('run'), pxat('walk'), pxat('idle'))], ['cbt_stand_combat_attack_light', tscl(3, pxat('hit'))], ['trn_incapacitated_to_stand', tscl(3.5, pxat('hit'))], ['cbt_attack_ranged', pxat('idle')]]);
ok(shared.clips.find((c) => c.name === 'run')!.names.join() === 'loop_stand,loop_stand_combat', 'two names on one file at one scale make one clip that lists both');
ok(shared.clips.some((c) => c.name === 'hit@x3') && shared.clips.some((c) => c.name === 'hit@x3.5'), 'the same file at two time scales makes two clips');
ok(shared.clips.some((c) => c.name === 'idle') && shared.clips.some((c) => c.name === 'idle~once'), 'a file played looped and once makes two clips, the second marked');
const missing = planOf([['loop_stand', spat(pxat('gone'), pxat('walk'))]]);
ok(missing.missing.length === 1 && missing.missing[0].endsWith('gone.ans') && missing.clips.length === 1, 'an animation the archives have not got is listed as missing and makes no clip');
const oneFrame = planOf([['loop_stand', pxat('shot')], ['add_pistol_fire_1', pxat('shot')]]);
ok(shared.clips.find((c) => c.name === 'idle')!.frames === 101 && oneFrame.clips[0].frames === 2 && oneFrame.clips[0].loop === false, 'a looped clip gains its closing key and a one-frame clip is held for two');
ok(oneFrame.clips[0].fps === 30 && oneFrame.clips.every((c) => Number.isFinite((c.frames - 1) / c.fps) && (c.frames - 1) / c.fps > 0), 'a zero frame rate is taken as 30, and no clip has a zero or infinite length');
ok(shared.logical.loop_stand.join() === 'idle,walk,run', 'a speed-selected name lists its clips slowest first');
const bytes = M.planPack({ id: 'b', key: 'k', table: 't', hierarchy: 'creature_base', joints: 2, names: new Map([['loop_stand', [{ file: 'appearance/animation/run.ans', timeScale: 1, path: [] }]]]), genders: false }, { header });
ok(bytes.estimatedBytes === 41 * (4 + 2 * 16) + 8 + 0 + 0 + (2 + 0 + 0) * 229 + 230, 'a clip that moves every joint costs its keys plus its JSON');
const oddLeaves = (() => {
  const t = M.tableNames(parseIff(Buffer.from(encode(lat('all_b', [
    ['loop_standing', ssat('gender', [form('XXXX', form('0000')), pxat('idle')], [['m', 0], ['f', 1]], 1)],
    ['loop_combat_standing', form('KFAT', form('0000'))],
  ])))));
  return M.planPack({ id: 'odd', key: 'k', table: 't', hierarchy: 'all_b', joints: 2, names: t.names, genders: true }, { header });
})();
ok(oddLeaves.skipped.filter((s) => s.name === 'loop_standing').length === 1
  && oddLeaves.skipped.some((s) => s.name === 'loop_combat_standing' && /inside the table/.test(s.why)),
'a branch this converter cannot follow is noted once per name, whether it is an unknown form or one held in the table');

// ---------------------------------------------------------------------------------------------
// 16-20. Roles

const creature = planOf([
  ['loop_stand', spat(pxat('run'), pxat('walk'), pxat('idle'))],
  ['cbt_stand_combat_attack_light', pxat('hit')],
  ['rea_stand_get_hit_light', pxat('hit')],
  ['trn_stand_to_incapacitated', tscl(2, pxat('hit'))],
  ['loop_incapacitated', pxat('idle')],
  ['trn_incapacitated_to_stand', tscl(3, pxat('hit'))],
]);
const creatureRoles = M.resolveRoles(creature, 'creature_base');
ok(creatureRoles.roles.idle === 'idle' && creatureRoles.roles.walk === 'walk' && creatureRoles.roles.run === 'run' && creatureRoles.roles.gaits.length === 2, 'a creature stands, walks and runs on its own table');
ok(creatureRoles.roles.attacks.length === 1 && creatureRoles.roles.hitLight === 'hit' && creatureRoles.sources.hitLight === 'rea_stand_get_hit_light'
  && creatureRoles.roles.down === 'hit@x2' && creatureRoles.roles.downLoop === 'idle' && creatureRoles.roles.getUp === 'hit@x3' && creatureRoles.roles.ranged === null,
"the hit, the fall and the getting up come from the hierarchy's own links");
const slowSwimmer = M.resolveRoles(planOf([['loop_swimming', spat(pxat('idle'), pxat('walk'))], ['loop_hovering', spat(pxat('idle'), pxat('walk'))]]), 'creature_base').roles;
const fastSwimmer = M.resolveRoles(planOf([['loop_swimming', spat(pxat('idle'), pxat('walk'), pxat('run'))]]), 'creature_base').roles;
ok(slowSwimmer.swimIdle === 'idle' && slowSwimmer.swim === 'walk' && slowSwimmer.hover === 'walk' && slowSwimmer.gaitsSwim.length === 1
  && fastSwimmer.swim === 'run', 'swimming and hovering have one moving clip whether the gait is slow or fast');
const still = M.gaitsOf([{ clip: 'a', speed: 0 }, { clip: 'b', speed: 0 }, { clip: 'c', speed: 25.15 }]);
ok(still.idle === 'a' && still.walk === null && still.run === 'c' && still.gaits.length === 1, 'a second still branch is ignored rather than called a walk');
const npc = planOf([
  ['loop_standing', spat(pxat('idle'), pxat('walk'), pxat('run'))],
  ['loop_pistol_standing', spat(pxat('idle'), pxat('walk'), pxat('run'))],
  ['add_pistol_fire_1', pxat('shot')],
  ['trn_rea_get_hit_heavy_backward', pxat('hit')],
  ['loop_incapacitated_face_up', pxat('idle')],
  ['emt_wave1', pxat('hit')],
], 'all_b');
const npcRoles = M.resolveRoles(npc, 'all_b');
ok(npcRoles.roles.ranged === 'shot' && npcRoles.roles.rangedAdditive === true && npcRoles.roles.rangedStance === 'idle', 'a humanoid shoots with the additive pose over its pistol stance');
ok(npcRoles.roles.down === 'hit' && npcRoles.roles.downLoop === 'idle' && npcRoles.roles.emotes.wave1 === 'hit', 'the heavy hit stands in for the fall when the table has no transition');
const genderPlan = (() => {
  const table = M.tableNames(parseIff(Buffer.from(encode(lat('all_b', [['loop_standing', ssat('gender', [spat(pxat('idle'), pxat('walk')), spat(pxat('hit'), pxat('walk'))], [['m', 0], ['f', 1]], 0)]])))));
  return M.planPack({ id: 'g', key: 'k', table: 't', hierarchy: 'all_b', joints: 2, names: table.names, genders: true }, { header });
})();
const genderRoles = M.resolveRoles(genderPlan, 'all_b');
ok(M.genderVariant(genderPlan, genderRoles.roles)['gender:f'].idle === 'hit' && Object.keys(M.genderVariant(npc, npcRoles.roles)).length === 0, 'a pack carries the roles that differ for a woman, and nothing when they do not');

// ---------------------------------------------------------------------------------------------
// 21-23. Baking

const two = skinData(skeleton2(), [{ name: 'x_loc_walk', animation: anim(2), loop: true }, { name: 'walk', animation: anim(2), loop: false }]);
ok(two.clips[0].times.length === 3 && two.clips[1].times.length === 2, 'the loop flag decides the closing key, whatever the clip is called');
ok(skinData(skeleton2(), [{ name: 'walk', animation: anim(2) }]).clips[0].times.length === 3, 'without the flag the name rule decides, as it always has');
const bakePlan = M.planPack({
  id: 'bake', key: 'k', table: 't', hierarchy: 'all_b', joints: 2, genders: false,
  names: new Map([
    ['loop_standing', [{ file: 'appearance/animation/walk.ans', timeScale: 1, path: [] }]],
    ['add_pistol_fire_1', [{ file: 'appearance/animation/shot.ans', timeScale: 1, path: [] }]],
  ]),
}, { header: (f: string) => (f.endsWith('walk.ans') ? { frames: 2, fps: 30, speed: 1, transforms: ['root', 'child'], animatedRotations: 2, animatedTranslations: 0, offsetTranslations: 0 } : headers['appearance/animation/shot.ans']) });
const baked = M.bakePack(bakePlan, { skeleton: skeleton2(['Root', 'Child']), loadAnimation: (f: string) => anim(f.endsWith('shot.ans') ? 1 : 2) });
const bakedJson = JSON.parse(baked.glb.toString('utf8', 20, 20 + baked.glb.readUInt32LE(12)));
ok(bakedJson.animations.length === 3 && baked.clips.length === 3 && baked.clips[2].name === 'bind_pose', 'a pack with an additive clip carries the bind pose beside it');
ok(bakePlan.bindPose === true && bakePlan.clipCount === baked.clips.length && bakePlan.estimatedBytes > bakePlan.clips.reduce((a: number, c: any) => a + c.frames, 0)
  && shared.bindPose === false && shared.clipCount === shared.clips.length, 'the plan counts and costs the bind pose the bake adds, and counts none when nothing is additive');
const shotClip = bakedJson.animations.find((a: any) => a.name === 'shot');
const shotInput = bakedJson.accessors[shotClip.samplers[0].input];
ok(shotInput.count === 2 && near(shotInput.max[0], 1 / 30, 1e-6), 'a one-frame shot is held for one frame rather than no time at all');
ok(baked.clips[1].joints.join() === 'Root,Child', 'an additive clip names its joints as the skeleton spells them');
const bindClip = bakedJson.animations.find((a: any) => a.name === 'bind_pose');
ok(bindClip.channels.length === 4, 'the bind pose keeps a track for every joint, which is what the additive blend needs');
const skinOnly = skinData(skeleton2(), []);
const fourFrames = () => {
  const times = Float32Array.of(0, 1 / 30, 2 / 30, 3 / 30);
  const tracks = skinOnly.joints.map((j: any, i: number) => ({
    rotations: Float32Array.from(Array.from({ length: 4 }, (_, f) => [0, 0, i === 1 ? f / 8 : 0, 1]).flat()),
    translations: Float32Array.from(Array.from({ length: 4 }, (_, f) => (i === 1 ? [j.translation[0], j.translation[1] + f / 8, j.translation[2]] : j.translation)).flat()),
  }));
  return { name: 'c', times, tracks, duration: 3 / 30 };
};
const compacted = JSON.parse((() => { const g = buildGlb([], { flipX: true, skin: { ...skinOnly, clips: [] }, animations: [fourFrames()], compactTracks: true }); return g.toString('utf8', 20, 20 + g.readUInt32LE(12)); })());
ok(compacted.animations[0].channels.length === 3 && compacted.accessors[compacted.animations[0].samplers[0].input].count === 2, 'a joint that holds still keeps two keys and one that never leaves its bind pose keeps none');
const keptAll = JSON.parse((() => { const g = buildGlb([], { flipX: true, skin: { ...skinOnly, clips: [] }, animations: [{ ...fourFrames(), keepAllTracks: true }], compactTracks: true }); return g.toString('utf8', 20, 20 + g.readUInt32LE(12)); })());
ok(keptAll.animations[0].channels.length === 4, 'the reference clip keeps every track');
const plain = buildGlb([], { flipX: true, skin: { ...skinOnly, clips: [] }, animations: [fourFrames()], compactTracks: false });
const asBefore = buildGlb([], { flipX: true, skin: { ...skinOnly, clips: [] }, animations: [fourFrames()] });
ok(plain.equals(asBefore) && JSON.parse(plain.toString('utf8', 20, 20 + plain.readUInt32LE(12))).animations[0].channels.length === 4, 'with compaction off the GLB is byte for byte what it always was');

// ---------------------------------------------------------------------------------------------
// 24-27. Customization

const split = M.splitCustomization({ '/private/index_color_1': 5, '/shared_owner/blend_fat': 51, 'pc_eye_zab.pal': 2, '/private/index_color_9': 1 }, new Set(['index_color_1']));
ok(JSON.stringify(split.values) === '{"index_color_1":5}' && split.morphs.blend_fat === 0.2 && split.ignored.join() === 'pc_eye_zab.pal,index_color_9', 'a template\'s values split into colours it reads, body shape, and the rest');
const noList = M.splitCustomization({ '/private/index_color_1': 5, '/shared_owner/blend_fat': 51 }, null);
ok(noList.values.index_color_1 === 5 && noList.ignored.length === 0 && noList.morphs.blend_fat === 0.2, 'with no list of readable names every non-morph value is kept rather than thrown away');
ok(M.comboKey({ b: 2, a: 1 }) === 'a=1;b=2' && /^v[0-9a-f]{8}$/.test(M.variantIdOf('a=1;b=2')) && M.variantIdOf('a=1;b=2') === M.variantIdOf('a=1;b=2'), 'a combination key sorts, and its id is stable');
const combos = [{ key: '', values: {}, templates: ['a', 'b', 'c'] }, { key: 'a=1', values: { a: 1 }, templates: ['d', 'e'] }, { key: 'a=2', values: { a: 2 }, templates: ['f'] }];
const planned = M.planVariants(combos, { maxVariants: 32 });
ok(planned.base.key === '' && planned.variants.map((v) => v.key).join() === 'a=1,a=2' && planned.dropped.length === 0, 'the commonest combination is the base and the others are variants');
ok(M.planVariants(combos, { maxVariants: 1 }).dropped[0].key === 'a=2', 'the cap drops the least used');
ok(M.planVariants([{ key: 'a=1', values: { a: 1 }, templates: ['a'] }, { key: '', values: {}, templates: ['b'] }], {}).base.key === '', 'a tie goes to the plain colours');
const shaderFile = 'shader/test.sht';
const shaderVfs = fakeVfs(new Map([[shaderFile, encode(cshd([tx1d('MAIN', 2, '/private/index_texture_1')], [pal('/private/index_color_1', 'TFAC', 'palette/a.pal'), pal('/shared_owner/index_color_2', 'TFC2', 'palette/b.pal')]))]]));
const viaLoad = loadShader(shaderVfs, shaderFile, renderContext()).variables.map((v: any) => v.name.replace(/^.*\//, ''));
ok(shaderVariableNames(shaderVfs, shaderFile).join() === viaLoad.join() && viaLoad.join() === 'index_texture_1,index_color_1,index_color_2', 'the names-only reader sees what the full shader loader sees');
ok(shaderVariableNames(fakeVfs(new Map([['shader/plain.sht', encode(form('SSHT', form('0000')))]])), 'shader/plain.sht').length === 0, 'a shader with no customization reads as none');

// ---------------------------------------------------------------------------------------------
// 28. Client data

const clientData = M.readClientData(parseIff(Buffer.from(encode(cldf(
  cssi('/private/index_color_1', 3),
  wear(mesh('appearance\\mesh\\Boots_S04_M.lmg'), mesh('appearance/mesh/pants_s04_m.lmg'), wcsi('/private/index_color_1', 31)),
  wear(mesh('appearance/mesh/vest_s01_m.lmg')))))))!;
ok(clientData.cssi['/private/index_color_1'] === 3 && clientData.wear.length === 2
  && clientData.wear[0].meshes.join() === 'appearance/mesh/boots_s04_m.lmg,appearance/mesh/pants_s04_m.lmg'
  && clientData.wear[0].values['/private/index_color_1'] === 31 && Object.keys(clientData.wear[1].values).length === 0,
'client data gives the colours, the worn meshes normalised, and the values for each form');

// ---------------------------------------------------------------------------------------------
// 29-31. Outfits

const index = M.wardrobeIndex({ items: [
  { id: 'appearance_invisible_s01', sat: 'appearance/vest_s01_m.sat', parts: [{ name: 'vest_s01_m_l0' }] },
  { id: 'vest_s01', sat: 'appearance/vest_s01_m.sat', parts: [{ name: 'vest_s01_m_l0' }] },
] });
ok(index.get('vest_s01_m_l0') === 'vest_s01', 'a part shared by two items goes to the one named after it');
const meshes: Record<string, any> = {
  'appearance/mesh/vest_s01_m.lmg': { exists: true, part: 'vest_s01_m_l0', skeletons: ['appearance/skeleton/all_b.skt'] },
  'appearance/mesh/dress_s01_f.lmg': { exists: true, part: 'dress_s01_f_l0', skeletons: ['appearance/skeleton/all_b.skt'] },
  'appearance/mesh/imperial_officer_m.lmg': { exists: true, part: 'imperial_officer_m_l0', skeletons: ['appearance/skeleton/all_b.skt'] },
  'appearance/mesh/npc_hat_f.lmg': { exists: true, part: 'npc_hat_f_l0', skeletons: ['appearance/skeleton/all_b.skt'] },
  'appearance/mesh/ith_shirt_s02_m.lmg': { exists: true, part: 'ith_shirt_s02_m_l0', skeletons: ['appearance/skeleton/ithorian.skt'] },
  'appearance/mesh/gone.lmg': { exists: false, part: 'gone', skeletons: [] },
};
const wardrobes = new Map([
  ['human_male', new Map([['vest_s01_m_l0', 'vest_s01']])],
  ['human_female', new Map([['dress_s01_f_l0', 'dress_s01']])],
]);
const target = { own: 'human_male', other: 'human_female', skeletons: ['appearance/skeleton/all_b.skt', 'appearance/skeleton/hum_m_face.skt'], folderOf: (part: string) => (/_f(_|$)/.test(part) ? 'human_female' : 'human_male') };
const outfit = M.resolveOutfit([{ meshes: Object.keys(meshes), values: { '/private/index_color_1': 7 } }], { target, wardrobes, present: new Set(['human_male', 'human_female']), meshInfo: (m: string) => meshes[m] });
ok(outfit.outfit[0].wardrobe === 'wardrobe/human_male' && outfit.outfit[0].values.index_color_1 === 7, 'a piece in the wearer\'s own wardrobe comes from there, with its colours');
ok(outfit.outfit[1].wardrobe === 'wardrobe/human_female', 'a piece only the other gender has comes from that wardrobe');
ok(outfit.outfit[2].item === 'npc_imperial_officer_m' && outfit.outfit[2].wardrobe === 'mobiles/wearables/human_male' && outfit.outfit[3].wardrobe === 'mobiles/wearables/human_female', 'a piece no wardrobe has becomes an NPC-only item, in the folder its name says');
ok(outfit.missing.some((m) => m.why.startsWith('built for ithorian')) && outfit.missing.some((m) => m.why === 'not in the archives') && outfit.npcOnly.length === 2, 'a piece for another skeleton and one the archives lack are both recorded as missing');
const deferred = M.resolveOutfit([{ meshes: ['appearance/mesh/imperial_officer_m.lmg'], values: {} }], { target, wardrobes: new Map([['human_male', wardrobes.get('human_male')!]]), present: new Set(['human_male']), meshInfo: (m: string) => meshes[m] });
ok(deferred.missing[0].why === 'wardrobe human_female not converted' && deferred.npcOnly.length === 0, 'with a wardrobe still to convert, nothing is planned as NPC-only');
const wearableUnits = new Map([['human_male', { ready: true, items: ['npc_imperial_officer_m'] }], ['human_female', { ready: false, items: null }]]);
ok(M.outfitReadyOf({ outfit: [{ part: 'a', item: 'vest_s01', wardrobe: 'wardrobe/human_male', values: {} }] }, { wardrobesPresent: new Set(['human_male']), wearableUnits }).ready, 'an outfit from a converted wardrobe is ready');
ok(!M.outfitReadyOf({ outfit: [{ part: 'a', item: 'npc_hat_f', wardrobe: 'mobiles/wearables/human_female', values: {} }] }, { wardrobesPresent: new Set(['human_male']), wearableUnits }).ready
  && !M.outfitReadyOf({ outfit: [{ part: 'a', item: 'npc_other', wardrobe: 'mobiles/wearables/human_male', values: {} }] }, { wardrobesPresent: new Set(['human_male']), wearableUnits }).ready,
'an outfit waiting on a wearable folder, or on a piece that folder has not got, is not ready');
ok(M.outfitReadyOf({ outfit: [], outfitMissing: [{ part: 'a', mesh: 'b', why: 'built for ewok, not all_b' }] }, { wardrobesPresent: new Set(), wearableUnits }).ready
  && M.outfitReadyOf({ outfit: [], outfitMissing: [{ part: 'a', mesh: 'b', why: 'wardrobe human_female not converted' }] }, { wardrobesPresent: new Set(), wearableUnits }).why === 'wardrobe/human_female not converted',
'a piece that can never fit does not hold an entry back, and one waiting for a wardrobe does');

// ---------------------------------------------------------------------------------------------
// 32-34. Names

ok(M.cleanName('a rancor\n') === 'Rancor' && M.cleanName('the  Mos  Eisley guard') === 'Mos Eisley guard' && M.cleanName('Aurra Sing') === 'Aurra Sing', 'a name loses its article, its line break and its double spaces');
ok(M.labelOf('ep3_blackscale_guard_m_01').label === 'Blackscale guard (male 01)'
  && M.labelOf('dressed_ep3_clone_relics_jawl').label === 'Clone relics jawl'
  && M.labelOf('bm_peko_peko_mount').label === 'Peko peko mount'
  && M.labelOf('3po_protocol_droid_red').label === '3po protocol droid red'
  && M.labelOf('dressed_blood_razor_pirate_berzerker_hum_f').label === 'Blood razor pirate berzerker (female)'
  && M.labelOf('coa_lag_personnel_hum_f1').label === 'Coa lag personnel (female 1)'
  && M.labelOf('aqualish_male').label === 'Aqualish (male)', 'a file name becomes a label the spawner can show');
const table: Record<string, string> = { 'npc_name:stormtrooper': 'Stormtrooper', 'npc_name:human_base_female': 'Human female', 'mob/creature_names:rancor': 'a rancor', 'monster_name:jawa_n': 'Jawa' };
const lookup = (t: string, k: string) => table[`${t}:${k}`] ?? null;
ok(M.displayNameOf({ template: 'object/mobile/shared_dressed_stormtrooper_m.iff', objectName: { table: 'npc_name', key: 'stormtrooper' }, lookup }).source === 'objectName', 'a specific name is used as it is');
const generic = M.displayNameOf({ template: 'object/mobile/shared_dressed_x_hum_f.iff', objectName: { table: 'npc_name', key: 'human_base_female' }, lookup });
ok(generic.source === 'label' && generic.subtitle === 'Human female' && generic.name === 'X (female)', 'a species name becomes the subtitle and the file name the label');
ok(M.displayNameOf({ template: 'object/mobile/shared_rancor.iff', objectName: { table: 'npc_name', key: 'rancor' }, lookup: (t: string, k: string) => (t === 'npc_name' ? 'an unknown creature' : lookup(t, k)) }).source === 'otherTable', 'an unknown creature falls through to the other name tables');
ok(M.displayNameOf({ template: 'object/mobile/shared_jawa.iff', objectName: { table: 'npc_name', key: '' }, lookup }).source === 'fileKey', 'an empty key falls through to the file name as a key');
ok(M.displayNameOf({ template: 'object/mobile/shared_nothing_here.iff', lookup }).source === 'label'
  && M.displayNameOf({ template: 'object/mobile/hologram/shared_rancor.iff', folder: 'hologram', objectName: { table: 'mob/creature_names', key: 'rancor' }, lookup }).name === 'Rancor (hologram)'
  && M.displayNameOf({ template: 'object/mobile/beast_master/shared_bm_rancor.iff', folder: 'beast_master', objectName: { table: 'mob/creature_names', key: 'rancor' }, lookup }).name === 'Rancor (pet)',
'with no name anywhere the label stands, and a hologram or a pet says which it is');

// ---------------------------------------------------------------------------------------------
// 35-38. Stats

const rancorBounds = { min: [-4.87, -1.52, -4.08], max: [4.87, 7.98, 4.08] };
ok(M.sizeClassOf(rancorBounds) === 'huge' && M.sizeClassOf({ min: [0, 0, 0], max: [0.79, 0.1, 0.1] }) === 'tiny' && M.sizeClassOf({ min: [0, 0, 0], max: [0.8, 0.1, 0.1] }) === 'small'
  && M.sizeClassOf({ min: [4.87, 7.98, 4.08], max: [-4.87, -1.52, -4.08] }) === 'huge', 'size comes from the extents, whichever way round the corners are');
const rancorStats = M.heuristicStats({ kind: 'creature', family: 'predator', sizeClass: 'huge', bounds: rancorBounds, keywords: [], flags: [], roles: { attacks: ['a'], ranged: 'r', rangedAdditive: false } });
ok(rancorStats.hp === 800 && rancorStats.damage === 48 && near(rancorStats.reach, 5.67, 0.01) && rancorStats.aggression === 'aggressive' && rancorStats.ranged!.range === 20, 'a huge predator that spits is a rancor');
ok(M.heuristicStats({ kind: 'creature', family: 'critter', sizeClass: 'tiny', keywords: ['young'], flags: [], roles: { attacks: ['a'] } }).hp === 15, 'a young critter is half of a tiny one');
ok(M.heuristicStats({ kind: 'creature', family: 'critter', sizeClass: 'tiny', keywords: ['young'], flags: [], roles: { attacks: ['a'] } }).aggression === 'skittish'
  && M.heuristicStats({ kind: 'npc', sizeClass: 'small', keywords: [], flags: ['hologram'], roles: { attacks: ['a'] } }).aggression === 'passive'
  && M.heuristicStats({ kind: 'droid', family: 'machine', sizeClass: 'small', keywords: [], flags: [], roles: { attacks: [], ranged: null } }).aggression === 'passive'
  && M.heuristicStats({ kind: 'dressed', sizeClass: 'small', keywords: M.keywordsOf('rebel_recruiter'), flags: [] }).aggression === 'defensive'
  && M.heuristicStats({ kind: 'dressed', sizeClass: 'small', keywords: M.keywordsOf('rebel_trooper'), flags: [] }).aggression === 'aggressive',
'temper follows the family, the flags and the name, with hostile words before faction ones');
const boss = M.heuristicStats({ kind: 'creature', family: 'herd', sizeClass: 'small', keywords: ['boss', 'elite'], flags: [], roles: { attacks: ['a'] } });
ok(boss.hp === Math.round(80 * 2.5 * 1.5) && boss.damage === Math.round(8 * 1.5 * 1.25), 'a boss that is also elite multiplies both');

// ---------------------------------------------------------------------------------------------
// 39-41. Core3

const core3Text = `
rancor = Creature:new {
	objectName = "@mob/creature_names:rancor",
	socialGroup = "rancor",
	faction = "",
	level = 50,
	chanceHit = 0.5,
	damageMin = 395,
	damageMax = 500,
	baseXp = 8000,
	baseHAM = 10000,
	baseHAMmax = 12000,
	armor = 2,
	pvpBitmask = AGGRESSIVE + ATTACKABLE + ENEMY,
	creatureBitmask = PACK + KILLER,
	diet = CARNIVORE,
	templates = {"object/mobile/rancor.iff"},
	weapons = {},
	attacks = {
		{"creatureareaattack",""},
		{"stunattack",""}
	}
}
pirate = Creature:new {
	level = 30,
	baseHAM = 2000,
	baseHAMmax = 2500,
	damageMin = 100,
	damageMax = 140,
	pvpBitmask = ATTACKABLE,
	creatureBitmask = NONE,
	primaryWeapon = "pirate_weapons_heavy",
	templates = {"object/mobile/rancor.iff"}
}
`;
const core3 = parseCore3Mobiles(core3Text, 'mobile/rancor.lua');
ok(core3.length === 2 && core3[0].templates[0] === 'object/mobile/shared_rancor.iff' && core3[0].pvp.includes('AGGRESSIVE') && core3[0].attacks === 2, 'a Core3 block gives its templates, its flags and how many attacks it has');
ok(core3[1].weapons.join() === 'pirate_weapons_heavy' && core3[0].ham![0] === 10000, 'both weapon spellings are read, and the HAM pool comes through');
const byTemplate = new Map([['object/mobile/shared_rancor.iff', [core3[1], core3[0]].sort((a, b) => (a.level ?? 0) - (b.level ?? 0))]]);
const heuristic = M.heuristicStats({ kind: 'creature', family: 'predator', sizeClass: 'huge', bounds: rancorBounds, keywords: [], flags: [], roles: { attacks: ['a'] } });
const fromCore3 = M.core3StatsFor(byTemplate.get('object/mobile/shared_rancor.iff'), heuristic, { kind: 'creature' });
ok(fromCore3.source === 'core3' && fromCore3.level === 30 && fromCore3.core3!.mobiles === 2 && fromCore3.aggression === 'defensive' && fromCore3.reach === heuristic.reach, 'the weakest mobile on a template sets its stats, and the reach stays the model\'s');
const npcRanged = M.core3StatsFor([{ ...core3[1], weapons: ['pirate_weapons_pistol'] }], heuristic, { kind: 'npc' });
ok(npcRanged.ranged!.range === 20 && M.core3StatsFor([{ ...core3[1], weapons: ['unarmed_weapons'] }], heuristic, { kind: 'npc' }).ranged === null, 'a person with a pistol shoots and one with fists does not');
const entries = [{ id: 'a', stats: { source: 'heuristic' } }, { id: 'b', stats: { source: 'heuristic' } }];
ok(M.carryCore3(entries, { entries: [{ id: 'a', stats: { source: 'core3', hp: 5 } }, { id: 'b', stats: { source: 'heuristic', hp: 1 } }] }) === 1 && (entries[0].stats as any).hp === 5 && entries[1].stats.source === 'heuristic', 'Core3 stats are carried forward and estimates are not');
ok(core3MobileStats('A:/no/such/folder').size === 0, 'no Core3 checkout is not an error');

// ---------------------------------------------------------------------------------------------
// 42-44. Units

const archives: [string, number][] = [['a.tre', 10], ['b.tre', 20]];
const stamp = M.sourceStampOf({ retailOnly: true, archives });
ok(stamp.key === M.sourceStampOf({ retailOnly: true, archives: [...archives].reverse() }).key
  && stamp.key !== M.sourceStampOf({ retailOnly: false, archives }).key
  && stamp.key !== M.sourceStampOf({ retailOnly: true, archives: [...archives, ['c.tre', 1]] }).key
  && stamp.key !== M.sourceStampOf({ retailOnly: true, archives: [['a.tre', 11], ['b.tre', 20]] }).key,
'the archive stamp ignores their order and notices a flag, an archive or a size');
ok(M.signatureOf({ source: stamp.key, sat: 'x' }) !== M.signatureOf({ source: 'other', sat: 'x' }), 'a unit converted from other archives has another signature');
const sizes: Record<string, number> = { 'mobiles/models/x.glb': 100 };
// The written format is whatever the converter writes now, not a number typed in here: a bump is
// meant to make every pack on disk read as old, and this record stands for one just written.
const record = { format: M.MOBILES_FORMAT, unit: 'model', id: 'x', sig: 'sig', source: stamp, code: 'c', written: '', files: [{ path: 'mobiles/models/x.glb', bytes: 100 }] };
const sizeOf = (p: string) => sizes[p] ?? null;
ok(M.unitState(null, { sig: 'sig', source: stamp }, sizeOf) === 'missing'
  && M.unitState({ ...record, format: M.MOBILES_FORMAT - 1 }, { sig: 'sig', source: stamp }, sizeOf) === 'oldFormat'
  && M.unitState({ ...record, source: { ...stamp, key: 'other' } }, { sig: 'sig', source: stamp }, sizeOf) === 'foreign'
  && M.unitState({ ...record, files: [{ path: 'mobiles/models/gone.glb', bytes: 1 }] }, { sig: 'sig', source: stamp }, sizeOf) === 'incomplete'
  && M.unitState({ ...record, files: [{ path: 'mobiles/models/x.glb', bytes: 99 }] }, { sig: 'sig', source: stamp }, sizeOf) === 'incomplete'
  && M.unitState(record, { sig: 'other', source: stamp }, sizeOf) === 'stale'
  && M.unitState(record, { sig: 'sig', source: stamp }, sizeOf) === 'current'
  && M.unitState({ ...record, sig: 'other', source: { ...stamp, key: 'other' } }, { sig: 'sig', source: stamp }, sizeOf) === 'foreign',
'a unit is missing, old, foreign, incomplete, stale or current, in that order');
ok(M.codeStampOf(['a\r\nb']) === M.codeStampOf(['a\nb']) && M.codeStampOf(['a', 'b']) !== M.codeStampOf(['ab', '']), 'the code stamp ignores line endings and not where one file ends');

// ---------------------------------------------------------------------------------------------
// 45-46. Selection and the catalogue

const entryOf = (id: string, kind: string, appearance: string | null, pack: string | null, outfit: any[] = []) =>
  ({ id, template: `object/mobile/shared_${id}.iff`, kind, folder: '', group: '', name: id, nameSource: 'label', subtitle: null, flags: [], gender: null, appearance, species: kind === 'dressed' ? 'human_male' : null, pack, variant: null, custom: {}, morphs: {}, outfit, size: {}, move: {}, gameObjectType: 1025, stats: { source: 'heuristic' }, ...(kind === 'dressed' ? { speciesReady: true } : {}) });
const appearanceOf = (id: string, pack: string, form: string | null = 'glb') =>
  [id, { id, sat: `appearance/${id}.sat`, form, file: `mobiles/models/${id}.glb`, record: `mobiles/models/${id}.json`, sig: `sig-${id}`, pack, skeletons: [], joints: 2, bounds: null, sizeClass: 'small', readable: [], base: {}, variants: {}, variantList: [], riderPose: null, templates: 1, playerBody: null, dropped: [] }];
const smallPlan: any = {
  source: stamp, options: {},
  entries: [
    entryOf('rancor', 'creature', 'rancor', 'rancor'),
    entryOf('graul', 'creature', 'graul', 'rancor'),
    entryOf('hologram/rancor', 'creature', 'rancor', 'rancor'),
    entryOf('dressed_trooper', 'dressed', null, 'all_m-all_b-hum_m_face', [{ part: 'p', item: 'npc_x', wardrobe: 'mobiles/wearables/human_male', values: {} }]),
    entryOf('aqualish_male', 'npc', 'aqualish_m_01', 'all_m-all_b-hum_m_face'),
  ],
  appearances: new Map([appearanceOf('rancor', 'rancor'), appearanceOf('graul', 'rancor'), appearanceOf('aqualish_m_01', 'all_m-all_b-hum_m_face', 'parts')] as any),
  packs: new Map([['rancor', { id: 'rancor', file: 'mobiles/anims/rancor.glb', json: 'mobiles/anims/rancor.json', sig: 'sig-p1', hierarchy: 'creature_base', set: 'full', clips: [], appearances: ['rancor', 'graul'], speciesRigs: [] }], ['all_m-all_b-hum_m_face', { id: 'all_m-all_b-hum_m_face', file: 'f.glb', json: 'mobiles/anims/all_m-all_b-hum_m_face.json', sig: 'sig-p2', hierarchy: 'all_b', set: 'curated', clips: [], appearances: ['aqualish_m_01'], speciesRigs: ['human_male'] }]]),
  wearables: new Map([['human_male', { folder: 'human_male', dir: 'mobiles/wearables/human_male', record: 'mobiles/wearables/human_male.json', sig: 'sig-w', skeleton: 'appearance/skeleton/all_b.skt', meshes: [{ lmg: 'a', part: 'npc_x' }] }]]),
  wardrobes: {}, excluded: [], failed: [],
};
const onlyCreatures = M.selectWork(smallPlan, { only: ['creature'] });
ok(onlyCreatures.packs.size === 1 && onlyCreatures.models.size === 2 && onlyCreatures.wearables.size === 0, '--only=creatures takes the creatures\' models and their one pack');
ok(M.selectWork(smallPlan, { only: ['creatures'] }).models.size === 2 && M.selectWork(smallPlan, { only: ['droids'] }).models.size === 0 && M.selectWork(smallPlan, { only: ['dressed'] }).packs.size === 1, 'a kind is taken singular or plural');
const one = M.selectWork(smallPlan, { match: '^rancor$' });
ok(one.models.size === 1 && one.models.has('rancor') && one.packs.size === 1 && !one.models.has('graul'), 'a match on one id takes that model and its pack, not the others on the pack');
ok(M.selectWork(smallPlan, { match: '^graul$' }).models.has('graul') && M.selectWork(smallPlan, { match: '^graul$' }).packs.has('rancor'), 'a match on another appearance takes that model and the same pack');
const packOnly = M.selectWork(smallPlan, { match: '^all_m-all_b-hum_m_face$' });
ok(packOnly.packs.size === 1 && packOnly.models.size === 0 && packOnly.wearables.size === 0, 'a match on a pack id takes the pack alone');
ok(M.selectWork(smallPlan, { limit: 1 }).entries.size === 1, 'a limit keeps the first entries by id');
const dressedOnly = M.selectWork(smallPlan, { only: ['dressed'] });
ok(dressedOnly.packs.size === 1 && dressedOnly.wearables.size === 1 && dressedOnly.models.size === 0, '--only=dressed takes its pack and its wearable folder and no model');
const records = new Map<string, any>([
  ['mobiles/models/rancor.json', { format: M.MOBILES_FORMAT, unit: 'model', id: 'rancor', sig: 'sig-rancor', source: stamp, code: 'c', files: [{ path: 'mobiles/models/rancor.glb', bytes: 10 }], triangles: 3228, meshes: ['rancor_l0'], bounds: { min: [0, 0, 0], max: [1, 1, 1] }, bytes: 10, variants: { v1: { file: 'mobiles/variants/rancor/v1.glb', same: false, bytes: 5 } } }],
  ['mobiles/models/graul.json', { format: M.MOBILES_FORMAT, unit: 'model', id: 'graul', sig: 'other', source: stamp, code: 'c', files: [{ path: 'mobiles/models/graul.glb', bytes: 10 }], bytes: 10 }],
  ['mobiles/models/aqualish_m_01.json', { format: M.MOBILES_FORMAT, unit: 'model', id: 'aqualish_m_01', sig: 'sig-aqualish_m_01', source: { ...stamp, key: 'other' }, code: 'c', files: [] }],
  ['mobiles/anims/rancor.json', { format: M.MOBILES_FORMAT, unit: 'pack', id: 'rancor', sig: 'sig-p1', source: stamp, code: 'c', files: [], clips: [1, 2, 3], bytes: 7 }],
  ['mobiles/anims/all_m-all_b-hum_m_face.json', { format: M.MOBILES_FORMAT, unit: 'pack', id: 'x', sig: 'sig-p2', source: stamp, code: 'c', files: [] }],
]);
smallPlan.appearances.get('rancor').variants = { v1: { key: 'a=1', values: { a: 1 }, templates: 1 }, v2: { key: 'a=2', values: { a: 2 }, templates: 1 } };
const catalogue = M.assembleCatalogue(smallPlan, { records, sizeOf: (p: string) => (p.endsWith('graul.glb') || p.endsWith('rancor.glb') ? 10 : null), options: {}, wardrobes: { human_male: { references: 1, present: true } } });
const byId: Record<string, any> = Object.fromEntries(catalogue.entries.map((e: any) => [e.id, e]));
ok(catalogue.appearances.rancor.triangles === 3228 && catalogue.appearances.rancor.meshes[0] === 'rancor_l0' && catalogue.appearances.rancor.variants.v1.file === 'mobiles/variants/rancor/v1.glb', 'what a model\'s record learned reaches the catalogue');
ok(catalogue.appearances.rancor.variants.v2.file === null && byId.rancor.ready, 'a variant the record has not got shows the base colours and holds nothing back');
ok(catalogue.appearances.graul.unit === 'stale' && byId.graul.ready, 'a stale unit is still usable');
ok(catalogue.appearances.aqualish_m_01.unit === 'foreign' && !byId.aqualish_male.ready && /foreign/.test(byId.aqualish_male.notReady), 'a unit from other archives is not ready, and says so');
ok(byId.dressed_trooper.ready && !byId.dressed_trooper.outfitReady && byId.dressed_trooper.outfitNotReady === 'mobiles/wearables/human_male not converted', 'a dressed NPC whose wearables are missing is ready but not dressed');
ok(catalogue.counts.ready === catalogue.entries.filter((e: any) => e.ready).length && catalogue.counts.creature === 3 && catalogue.counts.entries === 5, 'the counts match the entries');
let threw = false;
try {
  M.assembleCatalogue({ ...smallPlan, entries: [entryOf('a', 'creature', null, null), entryOf('a', 'creature', null, null)] }, {});
} catch {
  threw = true;
}
ok(threw, 'two entries with one id stop the catalogue before it is written');

console.log(`${checks} checks passed`);
