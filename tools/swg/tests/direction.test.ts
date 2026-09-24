// The direction selector, from a hand-built animation table rather than from anybody's archives.
//
// Its tag is "DIR " -- three letters and a space, as "VAL " is in the string selector -- and both
// flatteners matched it as three characters, so every direction selector came back empty and so did
// every time-scale and probability selector wrapping one. Everything below fails against that
// reading: the three names whose only leaves sit under a direction selector had no leaves at all.
//
// The fixture names files and a hierarchy that exist nowhere; no archive is read and no pack.
import { form, chunk, W, encode } from './iffWriter.ts';
import { childOf, childrenOf, isForm, parseIff } from '../iff.mjs';
import { DIRECTION, directionSuffix, parseLat, flattenAnimationTemplate } from '../skeletal.mjs';
import { ALLB_ATTACKS, ALLB_RANGED, ALLB_RANGED_STANCES, ALLB_ROLES, ANIM_FORMAT, CURATED_ALL_B, MOBILES_FORMAT, chooseLeaves, resolveRoles, tableNames } from '../mobiles.mjs';
import { idleClipFor, ownGunIsPistol, type IdleSituation } from '../../../src/world/mobiles/packClips.ts';
import type { Roles } from '../../../src/world/mobiles/types.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------------------------------------
// The fixture: a logical animation table with four names.
//
//   aimed    a direction selector, seven branches, the codes the retail tables use
//   scaled   a time-scale selector wrapping a direction selector (the wrapped case)
//   speeds   a direction selector whose front branch is a speed selector of three
//   plain    no selector at all (the control: nothing about it may change)
const pxat = (file: string) => form('PXAT', form('0000', chunk('INFO', new W().str(file).bytes())));
const dir = (code: number, child: ReturnType<typeof form>) => form('DIR ', chunk('INFO', new W().i8(code).bytes()), child);
/** The seven codes every retail direction selector uses, front among them. */
const CODES = [DIRECTION.right, DIRECTION.left, DIRECTION.front, DIRECTION.frontRight, DIRECTION.frontLeft, DIRECTION.backRight, DIRECTION.backLeft];
const word = (code: number) => (Object.entries(DIRECTION).find(([, v]) => v === code) ?? ['dir'])[0];
const drat = (stem: string, frontChild?: ReturnType<typeof form>) =>
  form('DRAT', form('0000', chunk('INFO', new W().i8(CODES.length).bytes()),
    ...CODES.map((code) => dir(code, code === DIRECTION.front && frontChild ? frontChild : pxat(`appearance/animation/${stem}_${word(code)}.ans`)))));
const anim = (name: string, template: ReturnType<typeof form>) => form('ANIM', chunk('INFO', new W().str(name).bytes()), template);
const spat = (...files: string[]) => form('SPAT', form('0000', ...files.map(pxat)));

const latBytes = Buffer.from(encode(form('LATT', form('0003',
  chunk('INFO', new W().str('appearance/ash/fixture.ash').i16(4).bytes()),
  anim('aimed', drat('aimed')),
  anim('scaled', form('TSCL', form('0000', chunk('INFO', new W().f32(0.5).bytes()), drat('scaled')))),
  anim('speeds', drat('speeds', spat('appearance/animation/speeds_still.ans', 'appearance/animation/speeds_walk.ans', 'appearance/animation/speeds_run.ans'))),
  anim('plain', pxat('appearance/animation/plain.ans'))))));
const latRoot = parseIff(latBytes);

// ---------------------------------------------------------------------------------------------
// The tag itself, stated on the fixture so the failure is legible rather than inferred.
{
  const versionForm = latRoot.children.find(isForm)!;
  const aimedAnim = childrenOf(versionForm, 'ANIM')[0];
  const dratVersion = aimedAnim.children.find(isForm)!.children.find(isForm)!;
  check('"DIR" (three characters) matches nothing', childrenOf(dratVersion, 'DIR').length === 0);
  check('"DIR " (four characters) matches every branch', childrenOf(dratVersion, 'DIR ').length === CODES.length, `${childrenOf(dratVersion, 'DIR ').length}`);
  check('a branch carries a one-byte code', childOf(childrenOf(dratVersion, 'DIR ')[2], 'INFO').data.length === 1);
}

// The codes are a bitmask: front|right is front-right, back|left is back-left, and nothing is 0.
check('the codes compose as a bitmask', (DIRECTION.front | DIRECTION.right) === DIRECTION.frontRight && (DIRECTION.front | DIRECTION.left) === DIRECTION.frontLeft && (DIRECTION.back | DIRECTION.right) === DIRECTION.backRight && (DIRECTION.back | DIRECTION.left) === DIRECTION.backLeft);
check('no direction code is 0', Object.values(DIRECTION).every((v) => v !== 0));

// ---------------------------------------------------------------------------------------------
// Front only, and the front branch keeps the plain name. The old reading looked for code 0, which
// no table ever uses, so nothing would have been named plainly even with the tag corrected.
check('front keeps the plain name', directionSuffix(DIRECTION.front) === '');
check('every other direction is left unbaked', CODES.filter((c) => c !== DIRECTION.front).every((c) => directionSuffix(c) === null) && directionSuffix(DIRECTION.back) === null);
check('code 0 is not a direction and names nothing', directionSuffix(0) === null);

// ---------------------------------------------------------------------------------------------
// Through the shipped flattener: a name with a direction selector under it has leaves at all.
const lat = parseLat(latRoot);
const entriesOf = (name: string) => lat.entries.filter((e) => e.name === name || e.name.startsWith(`${name}:`));
/** The table's own names that flatten to nothing: what the old tag reading left behind. */
const deadNames = lat.logical.filter((n: string) => entriesOf(n).length === 0);

check('the table declares what it carries', lat.hierarchy === 'appearance/ash/fixture.ash' && lat.count === 4 && lat.logical.length === 4, `${lat.hierarchy} ${lat.count} ${lat.logical.length}`);
check('no name flattens to nothing', deadNames.length === 0, `dead: ${deadNames.join(', ')}`);
check('the three names under a direction selector are the ones recovered', lat.logical.filter((n: string) => n !== 'plain').every((n: string) => entriesOf(n).length > 0));

{
  const e = entriesOf('aimed');
  check('one leaf a name, not seven', e.length === 1, `${e.length}: ${e.map((x: { name: string }) => x.name).join(' ')}`);
  // Every read of e[0] is optional: with both flatteners regressed there is no leaf at all, and a
  // crash here would take the twenty checks below it with it instead of reporting them.
  check('it is the front leaf under the plain name', e[0]?.name === 'aimed' && e[0]?.kind === 'file' && e[0]?.file === 'appearance/animation/aimed_front.ans', JSON.stringify(e[0] ?? null));
  check('no :dir name is written while front is the only branch baked', lat.entries.every((x: { name: string }) => !x.name.includes(':dir')));
}
{
  // A time-scale selector wrapping a direction selector returned nothing at all before; now it
  // carries its scale down to the leaf.
  const e = entriesOf('scaled');
  check('a time scale over a direction selector reaches its leaf', e.length === 1 && e[0].file === 'appearance/animation/scaled_front.ans', JSON.stringify(e));
  check('the time scale multiplies through', e[0]?.timeScale === 0.5, `${e[0]?.timeScale}`);
}
{
  // The speed branches hang off the plain name, which is what makes the recovered aimed loop come
  // out as `<name>:speed0` -- the very name the player and the fighters already ask for by pattern.
  const e = entriesOf('speeds');
  check('a speed selector under the front branch names itself off the plain name', e.map((x: { name: string }) => x.name).join(' ') === 'speeds:speed0 speeds:speed1 speeds:speed2', e.map((x: { name: string }) => x.name).join(' '));
  check('each speed branch keeps its own file', e[1]?.file === 'appearance/animation/speeds_walk.ans');
}
check('a name with no selector is untouched', entriesOf('plain').length === 1 && entriesOf('plain')[0].name === 'plain');

// A direction selector with no front branch bakes nothing here: front only means front only, and a
// table that has no front branch is a fact about that table rather than something to guess around.
{
  const noFront = form('DRAT', form('0000', chunk('INFO', new W().i8(2).bytes()), dir(DIRECTION.right, pxat('appearance/animation/only_right.ans')), dir(DIRECTION.left, pxat('appearance/animation/only_left.ans'))));
  const root = parseIff(Buffer.from(encode(form('LATT', form('0003', chunk('INFO', new W().str('appearance/ash/fixture.ash').i16(1).bytes()), anim('sideways', noFront))))));
  check('a selector with no front branch bakes nothing', parseLat(root).entries.length === 0);
  // Widening is one return value: the same form, read with every direction named, gives seven.
  const template = root.children.find(isForm)!.children.find(isForm)!.children.find(isForm)!;
  check('the form itself does carry both branches', childrenOf(template.children.find(isForm)!, 'DIR ').length === 2);
  check('flattening it by hand is what a wider set would do', flattenAnimationTemplate(template, 'sideways').length === 0);
}

// ---------------------------------------------------------------------------------------------
// The mobiles flattener keeps every direction and picks between them by penalty, so its answer has
// to be the front one too, or a pack and a rig would disagree about which way a body is facing.
{
  const t = tableNames(latRoot);
  check('the path-keeping flattener finds every name', t.names.size === 4 && t.hierarchy === 'fixture', `${t.names.size} ${t.hierarchy}`);
  check('it keeps all seven direction branches', (t.names.get('aimed') ?? []).length === CODES.length, `${(t.names.get('aimed') ?? []).length}`);
  const chosen = chooseLeaves(t.names.get('aimed'), {});
  check('and chooses the front one', chosen.length === 1 && chosen[0].file === 'appearance/animation/aimed_front.ans', JSON.stringify(chosen.map((c: { file: string }) => c.file)));
  const speeds = chooseLeaves(t.names.get('speeds'), {});
  check('one leaf per speed branch, all from the front direction', speeds.length === 3 && speeds.every((s: { file: string }) => /speeds_(still|walk|run)/.test(s.file)), JSON.stringify(speeds.map((s: { file: string }) => s.file)));
}

// ---------------------------------------------------------------------------------------------
// What the recovered names do to the roles a pack carries. The plan is hand-built: these are pure
// rules over names and speeds, and nothing here needs an animation.
const planOf = (logical: Record<string, string[]>, speeds: Record<string, number> = {}) => ({
  hierarchy: 'all_b',
  logical,
  clips: Object.values(logical).flat().map((name) => ({ name, speed: speeds[name] ?? 0 })),
});
{
  const withAimed = planOf({
    loop_pistol_combat_standing_aimed: ['aimed_idle', 'aimed_walk'],
    loop_pistol_combat_standing: ['ready_idle'],
    loop_pistol_standing: ['holster_idle'],
    pistol_combat_standing_fire_1: ['shot'],
    add_pistol_fire_1: ['recoil'],
  }, { aimed_walk: 1.4 });
  const r = resolveRoles(withAimed, 'all_b');
  check('a whole-body shot beats the additive recoil', r.sources.ranged === 'pistol_combat_standing_fire_1' && r.roles.ranged === 'shot' && r.roles.rangedAdditive === false, JSON.stringify(r.sources));
  check('the stance is the aimed loop’s still branch', r.roles.rangedStance === 'aimed_idle', `${r.roles.rangedStance}`);

  const noAimed = planOf({ loop_pistol_combat_standing: ['ready_idle'], loop_pistol_standing: ['holster_idle'], pistol_combat_standing_fire_1: ['shot'] });
  check('without the aimed loop it falls back to the ready one', resolveRoles(noAimed, 'all_b').roles.rangedStance === 'ready_idle');
  const holsterOnly = planOf({ loop_pistol_standing: ['holster_idle'], pistol_combat_standing_fire_1: ['shot'] });
  check('and to the holstered carry last of all', resolveRoles(holsterOnly, 'all_b').roles.rangedStance === 'holster_idle');

  const additiveOnly = planOf({ add_pistol_fire_1: ['recoil'], loop_pistol_standing: ['holster_idle'] });
  const ra = resolveRoles(additiveOnly, 'all_b');
  check('a table with only the recoil still reads as additive', ra.roles.ranged === 'recoil' && ra.roles.rangedAdditive === true);

  const stances = planOf({ loop_rifle_a_combat_standing_aimed: ['r_aimed'], loop_rifle: ['r_holster'], rifle_standing_aimed_fire_1: ['r_shot'] });
  check('the rifle takes its own stance list', resolveRoles(stances, 'all_b').roles.rangedStance === 'r_aimed');

  const combat = planOf({ trn_standing_to_sword_1h_standing_ready: ['up'], trn_unarmed_standing_ready_to_standing: ['down'] });
  const rc = resolveRoles(combat, 'all_b');
  check('a humanoid now has a way into and out of combat', rc.roles.toCombat === 'up' && rc.roles.fromCombat === 'down', JSON.stringify([rc.roles.toCombat, rc.roles.fromCombat]));
}

// ---------------------------------------------------------------------------------------------
// The candidate tables. A role candidate that the curated set does not bake can never be chosen,
// so the two lists have to agree; and the order of ALLB_RANGED is what makes a pistol carrier fire
// with its whole body rather than twitching an additive over a breathing loop.
{
  const curated = new Set(CURATED_ALL_B);
  check('the curated set has no duplicate', curated.size === CURATED_ALL_B.length, `${CURATED_ALL_B.length - curated.size} repeated`);
  const candidates = [...Object.values(ALLB_ROLES).flat(), ...ALLB_ATTACKS, ...ALLB_RANGED, ...ALLB_RANGED_STANCES.pistol, ...ALLB_RANGED_STANCES.rifle];
  const orphan = candidates.filter((n) => !curated.has(n));
  check('every role candidate is a name the pack bakes', orphan.length === 0, `not in the curated set: ${orphan.join(', ')}`);
  check('the whole-body shots come before the additive recoils', ALLB_RANGED.indexOf('pistol_combat_standing_fire_1') < ALLB_RANGED.indexOf('add_pistol_fire_1') && ALLB_RANGED.indexOf('rifle_standing_aimed_fire_1') < ALLB_RANGED.indexOf('add_rifle_fire_1'));
  check('each stance list runs aimed, ready, relaxed', ALLB_RANGED_STANCES.pistol.length === 3 && ALLB_RANGED_STANCES.pistol[0].endsWith('_aimed') && ALLB_RANGED_STANCES.rifle[0].endsWith('_aimed'));
  check('the humanoid roles name a way into and out of combat', ALLB_ROLES.toCombat.length > 0 && ALLB_ROLES.fromCombat.length > 0);
  // The sets the owner asked for: every posture, both weapons' aimed stances, and six shots each.
  const has = (n: string) => curated.has(n);
  check('the aimed standing stances are baked', has('loop_pistol_combat_standing_aimed') && has('loop_rifle_a_combat_standing_aimed') && has('loop_pistol_combat_standing') && has('loop_rifle_combat_standing'));
  check('six standing shots a weapon', [1, 3, 5, 7, 9, 11].every((n) => has(`pistol_combat_standing_fire_${n}`)) && [1, 3, 5, 7, 9, 11].every((n) => has(`rifle_standing_aimed_fire_${n}`)));
  check('six kneeling shots a weapon', ['pistol_combat_kneeling_fire_1', 'pistol_combat_kneeling_fire_3', 'pistol_combat_kneeling_fire_5', 'pistol_combat_kneeling_fire_7', 'pistol_kneeling_fire_9', 'pistol_kneeling_fire_11'].every(has) && [1, 3, 5, 7, 9, 11].every((n) => has(`rifle_kneeling_fire_${n}`)));
  check('the three low postures and every way between them', ['loop_kneeling', 'loop_prone', 'loop_crouched', 'trn_standing_to_kneeling', 'trn_kneeling_to_standing', 'trn_kneeling_to_prone', 'trn_prone_to_kneeling', 'trn_standing_to_prone', 'trn_prone_to_standing', 'trn_standing_to_crouched', 'trn_crouched_to_standing', 'trn_crouched_to_kneeling'].every(has));
  check('a kneeling and a prone stance for each weapon, aimed and not', ['loop_pistol_combat_kneeling', 'loop_pistol_combat_kneeling_aimed', 'loop_rifle_kneeling_combat', 'loop_rifle_kneeling_combat_aimed', 'loop_pistol_combat_prone', 'loop_pistol_combat_prone_aimed', 'loop_rifle_combat_prone', 'loop_rifle_combat_prone_aimed'].every(has));
  check('the one-handed sword has a ready stance and six swings', has('loop_sword_1h_ready') && CURATED_ALL_B.filter((n) => /^sword_1h_standing_ready_/.test(n)).length === 6);
  check('the two-handed sword and the polearm are left out', !CURATED_ALL_B.some((n) => /sword2h|sword_2h|polearm/.test(n)));
  // The animation packs' own format is what goes stale, not the whole of `mobiles/`: the models,
  // the colour variants and the wearable folders hold nothing this pass touches, and rebuilding
  // them would be some 600 MiB of byte-identical output.
  check('the animation packs have a format of their own and it was bumped', Number.isInteger(ANIM_FORMAT) && ANIM_FORMAT >= 2 && ANIM_FORMAT !== MOBILES_FORMAT, `${ANIM_FORMAT} vs ${MOBILES_FORMAT}`);
  check('the unit format is left where it was, so nothing else is rebuilt', MOBILES_FORMAT === 1, `${MOBILES_FORMAT}`);
  // The converse of "every role candidate is a name the pack bakes": a name baked for nothing is
  // the cover, blaster and sword vocabulary waves 2 and 6 will read, and a name of any other shape
  // arriving with no reader should show up here rather than only on the disk bill.
  const readBySomething = new Set([...candidates, 'loop_standing', 'loop_combat_standing', 'loop_swimming']);
  const forLater = CURATED_ALL_B.filter((n) => !readBySomething.has(n) && !n.startsWith('emt_'));
  const COVER_OR_WEAPON = /^(loop_(kneeling|prone|crouched)|loop_(pistol|rifle)_|loop_sword_1h_ready|(add_)?(pistol|rifle)_[a-z0-9_]*fire_|sword_1h_standing_ready_|trn_(standing|kneeling|prone|crouched)_to_|trn_(pistol|rifle)_|rea_get_hit_)/;
  check('what is baked with no reader yet is all cover, blaster or sword', forLater.every((n) => COVER_OR_WEAPON.test(n)), `${forLater.filter((n) => !COVER_OR_WEAPON.test(n)).join(', ')}`);
}

// ---------------------------------------------------------------------------------------------
// What the game does with the three fields the widened set moves. The converter can only hand the
// runtime a name; these two rules are what decide whether the name is ever played, and both of
// them used to read `rangedAdditive`, which this pass turns false on 37 of the 88 humanoid and
// droid packs. They are pure, so they are pinned here beside the conversion that feeds them.
{
  const roles = (over: Partial<Roles>): Roles => ({
    idle: 'idle', walk: null, run: null, gaits: [],
    idleCombat: 'unarmed_combat_idle', walkCombat: null, runCombat: null, gaitsCombat: [],
    swimIdle: 'tread', swim: null, gaitsSwim: [], hoverIdle: 'hover', hover: null, gaitsHover: [],
    toCombat: null, fromCombat: null, turnLeft: null, turnRight: null,
    attacks: [], hoverAttacks: [], ranged: null, rangedAdditive: false, rangedStance: null,
    hitLight: null, hitMedium: null, hitHeavy: null, hitWhileDown: null,
    down: null, downLoop: null, getUp: null, knockdown: null, knockdownLoop: null, knockdownGetUp: null,
    swimDown: null, swimDownLoop: null, hoverDown: null, emotes: {}, bind: null, ...over,
  });
  const at = (over: Partial<IdleSituation> = {}): IdleSituation => ({ swimming: false, flying: false, shooting: false, fighting: false, ...over });

  const wholeBody = roles({ ranged: 'pistol_standing_aimed_fire_1', rangedAdditive: false, rangedStance: 'pistol_aimed_idle' });
  check('a whole-body shooter stands in its aimed pose', idleClipFor(wholeBody, at({ shooting: true, fighting: true })) === 'pistol_aimed_idle', `${idleClipFor(wholeBody, at({ shooting: true, fighting: true }))}`);
  const recoil = roles({ ranged: 'pistol_fire_1_add', rangedAdditive: true, rangedStance: 'pistol_aimed_idle' });
  check('so does one that pulses a recoil', idleClipFor(recoil, at({ shooting: true, fighting: true })) === 'pistol_aimed_idle');
  check('a fighter not shooting takes the combat idle', idleClipFor(wholeBody, at({ fighting: true })) === 'unarmed_combat_idle');
  check('with no stance a shooter takes the combat idle', idleClipFor(roles({ ranged: 'shot' }), at({ shooting: true, fighting: true })) === 'unarmed_combat_idle');
  check('standing about, the plain idle', idleClipFor(wholeBody, at()) === 'idle');
  check('swimming and hovering still come first', idleClipFor(wholeBody, at({ shooting: true, swimming: true })) === 'tread' && idleClipFor(wholeBody, at({ shooting: true, flying: true })) === 'hover');
  check('no roles at all, no clip', idleClipFor(null, at({ shooting: true })) === null);

  // The bolt and its sound follow the clip the body plays, and nothing else. The four shapes here
  // are the ones the packs on disk really hold: an additive pistol recoil, a whole-body pistol
  // shot, a clip named for no weapon (a walker's cannon, a zombie's aimed shot) and a rifle's.
  check('an additive pistol recoil fires the pistol', ownGunIsPistol(roles({ ranged: 'cbt_pistol_fire_1_add', rangedAdditive: true })));
  check('and so does the whole-body pistol shot that replaces it', ownGunIsPistol(roles({ ranged: 'cbt_pistol_standing_aimed_fire_1_front', rangedAdditive: false })));
  check('a clip named for no weapon fires the rifle', !ownGunIsPistol(roles({ ranged: 'combat_fire_add', rangedAdditive: true })) && !ownGunIsPistol(roles({ ranged: 'cbt_aimed_single_shot' })));
  check('a rifle clip fires the rifle', !ownGunIsPistol(roles({ ranged: 'cbt_rifle_fire_1_add', rangedAdditive: true })));
  check('nothing to fire is not a pistol', !ownGunIsPistol(roles({})) && !ownGunIsPistol(null));
}

console.log(failures ? `${failures} FAILURES` : 'all passed');
process.exit(failures ? 1 : 0);
