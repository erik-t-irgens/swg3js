// The converter half of the moods: which branches of an animation table's mood selector become
// clips, what each one is named, which values reach it, and what is said when there is no such
// selector at all. Every rule the pass promises is driven here on a table built in this file --
// no archive is read, and nothing here touches the runtime.
//
// The four rules, in the order they are checked:
//   1. a branch that plays the very animation the no-mood branch plays is left out (it is the
//      idle under another name, and baking it would put a second copy of one clip in the pack);
//   2. one entry per distinct animation, carrying every value that reaches it;
//   3. only a selector of the named variable counts -- never the gender's, which is the outer one
//      and the one the shipped flattener would have left on the leaf instead;
//   4. two runs over one table give identical entries, so a rerun writes the same bytes.
import assert from 'node:assert/strict';
import { form, chunk, W, encode, type Node } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { parseSkeleton, skinData } from '../skeletal.mjs';
import { padSingleFrame } from '../mobiles.mjs';
import { branchLabel, matchGroup, moodClips, moodEntries, moodGroups, normFile } from '../moods.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------
// Fixtures: an animation table of the shape the playable species share -- a gender selector
// outside a speed selector, and the mood selector under the still speed branch alone.

const pxat = (file: string) => form('PXAT', form('0000', chunk('INFO', new W().str(file).bytes())));
const spat = (...children: Node[]) => form('SPAT', form('0000', ...children));
const ssat = (variable: string, branches: Node[], values: [string, number][], dflt: number) => {
  const w = new W().i16(values.length);
  for (const [value, index] of values) w.str(value).i16(index);
  return form('SSAT', form('0000', chunk('INFO', new W().str(variable).bytes()), form('ANMS', ...branches), chunk('VAL ', w.bytes()), chunk('DFLT', new W().i16(dflt).bytes())));
};
const lat = (entries: [string, Node][]) =>
  form('LATT', form('0001', chunk('INFO', new W().str('appearance/ash/all_b.ash').i16(entries.length).bytes()),
    ...entries.map(([name, template]) => form('ANIM', chunk('INFO', new W().str(name).bytes()), template))));

const STAND = 'appearance/animation/stand.ans';
const WALK = 'appearance/animation/walk.ans';
const OTHER = 'appearance/animation/elsewhere.ans';

// The still branch's mood selector. Branch 0 is the default (the plain standing loop); one branch
// plays that same file under another name; two branches name one file between them; one branch
// carries two values.
const moodSelector = (extra: Node[] = [], extraValues: [string, number][] = []) =>
  ssat(
    'mood',
    [pxat(STAND), pxat('appearance/animation/stand_sad.ans'), pxat('appearance/animation/stand_angry.ans'), pxat('appearance/animation/stand_angry.ans'), pxat(STAND), ...extra],
    [['default', 0], ['calm', 0], ['npc_sad', 1], ['sad', 1], ['npc_angry', 2], ['angry', 2], ['furious', 3], ['conversation', 4], ...extraValues],
    0,
  );

// The male branch and the female branch both stand on the same animation with no mood set, which
// is what makes `matchGroup` need the entry's own values to tell them apart.
const femaleMoods = moodSelector([pxat('appearance/animation/stand_oola.ans')], [['themepark_oola', 5]]);
const table = parseIff(Buffer.from(encode(lat([
  ['loop_standing', ssat('gender', [spat(moodSelector(), pxat(WALK)), spat(femaleMoods, pxat(WALK))], [['o', 0], ['m', 0], ['f', 1]], 0)],
]))));

/** A named locomotion entry as `nameLocomotion` hands one over: the outermost selector's values. */
const named = (clip: string, file: string, values: string[] = ['o', 'm']) =>
  ({ name: `loop_standing:o:speed0`, clip, kind: 'file', file, timeScale: 1, variable: 'gender', values, isDefault: true, speed: 0 });

// ---------------------------------------------------------------------------------------------
// The pure pieces

ok(branchLabel(['default', 'calm']) === 'calm' && branchLabel(['npc_sad', 'sad']) === 'npc_sad' && branchLabel([], 7) === '7', 'a branch is named for its first value that is not "default"');
ok(normFile('\\Appearance\\Animation\\Stand.ANS') === 'appearance/animation/stand.ans', 'a path is compared with its slashes turned round, its leading slash gone and its case folded');

{
  const leaves = [
    { file: STAND, timeScale: 1, path: [{ k: 'sel', variable: 'gender', values: ['o', 'm'], isDefault: true, i: 0 }, { k: 'speed', i: 0 }, { k: 'sel', variable: 'mood', values: ['default', 'calm'], isDefault: true, i: 0 }] },
    { file: 'a.ans', timeScale: 1, path: [{ k: 'sel', variable: 'gender', values: ['o', 'm'], isDefault: true, i: 0 }, { k: 'speed', i: 0 }, { k: 'sel', variable: 'mood', values: ['npc_sad'], isDefault: false, i: 1 }] },
    { file: WALK, timeScale: 1, path: [{ k: 'sel', variable: 'gender', values: ['o', 'm'], isDefault: true, i: 0 }, { k: 'speed', i: 1 }] },
  ];
  const groups = moodGroups(leaves);
  ok(groups.length === 1 && groups[0].branches.length === 2, 'the leaves under one mood selector make one group and the leaf with none makes no group');
  ok(groups[0].base?.file === STAND && groups[0].branches.filter((b: any) => b.differs).length === 1, 'the group\'s base is the branch played with no mood set, and only the branch on another animation differs');
  ok(moodGroups(leaves, 'posture').length === 0 && groups[0].branches.every((b: any) => !b.values.includes('o')), 'a selector of another variable makes no group and lends no values: the gender\'s stay outside');
}

// ---------------------------------------------------------------------------------------------
// The whole pass over a table

{
  const { entries, notes } = moodEntries(table, [named('idle', STAND), named('walk', WALK), named('run', OTHER)]);
  const byClip = new Map(entries.map((e: any) => [e.clip, e]));

  ok(entries.length === 2 && byClip.has('idle:npc_sad') && byClip.has('idle:npc_angry'), 'the differing branches become one clip each, named for the branch');
  ok(!entries.some((e: any) => /:(calm|conversation|default)$/.test(e.clip)), 'a branch that plays the no-mood branch\'s own animation is not baked a second time');
  ok(byClip.get('idle:npc_angry').values.join(',') === 'npc_angry,angry,furious', 'two branches naming one animation are one clip carrying every value that reaches it');
  ok(entries.every((e: any) => e.variable === 'mood' && e.mood === true && e.kind === 'file' && e.isDefault === false), 'every entry is a mood entry, asked for outright, and never the gender selector\'s');
  ok(!entries.some((e: any) => (e.values ?? []).includes('themepark_oola')), 'the other gender\'s branch is not converted: the entry\'s own values pick its group');

  const idleNote = notes.find((n: string) => n.startsWith('idle:')) ?? '';
  ok(/2 clips converted/.test(idleNote) && /calm/.test(idleNote) && /conversation/.test(idleNote), 'the note says how many clips were converted and names the values that play the idle itself');

  // The headline of this pass is that the walk carries no mood selector at all, and its note must
  // say so from the table rather than in the words a failed lookup would also print.
  const walkNote = notes.find((n: string) => n.startsWith('walk:')) ?? '';
  const runNote = notes.find((n: string) => n.startsWith('run:')) ?? '';
  ok(/carries no mood selector at all/.test(walkNote), 'the walk\'s note says its own branch carries no mood selector');
  ok(/is not a leaf of loop_standing/.test(runNote) && runNote !== walkNote, 'an animation the logical name does not play reads differently from one that carries no selector');

  const again = moodEntries(table, [named('idle', STAND), named('walk', WALK), named('run', OTHER)]);
  ok(JSON.stringify(again) === JSON.stringify({ entries, notes }), 'two runs over one table give identical entries and identical notes, so a rerun writes the same bytes');
}

// The two readers normalise a path differently at the source; one uppercase letter in a table
// would otherwise empty the join and convert nothing at all while printing that there was no
// selector to find.
{
  const { entries, notes } = moodEntries(table, [named('idle', '/Appearance/Animation/Stand.ANS')]);
  ok(entries.length === 2 && !notes.some((n: string) => /no mood selector/.test(n)), 'a differently spelled path still joins: the moods are found');
}

// A table with no mood selector anywhere says that once, about the table, rather than per clip.
{
  const plain = parseIff(Buffer.from(encode(lat([['loop_standing', spat(pxat(STAND), pxat(WALK))]]))));
  const { entries, notes } = moodEntries(plain, [named('idle', STAND)]);
  ok(!entries.length && notes.length === 1 && /has no mood selector anywhere under it/.test(notes[0]), 'a table with no mood selector is said once, about the table');
}

// A logical name the table does not carry at all, and a base clip that is not a file.
{
  const { entries, notes } = moodEntries(table, [named('idle', STAND)], { logical: 'loop_sitting' });
  ok(!entries.length && /not in this animation table/.test(notes[0]), 'a logical name the table lacks is said plainly and nothing is converted');
  const inline = moodEntries(table, [{ ...named('idle', STAND), kind: 'inline' }]);
  ok(!inline.entries.length && /inline animation/.test(inline.notes.find((n: string) => n.startsWith('idle:')) ?? ''), 'a base clip that is not a file is passed over with its kind named');
}

// Two groups whose no-mood branches play one animation and an entry whose values pick neither:
// answered with none, and said as ambiguity rather than as an absence.
{
  const groups = moodGroups([
    { file: STAND, timeScale: 1, path: [{ k: 'sel', variable: 'gender', values: ['o'], isDefault: true, i: 0 }, { k: 'sel', variable: 'mood', values: ['default'], isDefault: true, i: 0 }] },
    { file: STAND, timeScale: 1, path: [{ k: 'sel', variable: 'gender', values: ['f'], isDefault: false, i: 1 }, { k: 'sel', variable: 'mood', values: ['default'], isDefault: true, i: 0 }] },
  ]);
  const m = matchGroup(groups, { file: STAND, timeScale: 1, values: ['x'] }, null, 'mood');
  ok(m.group === null && m.why === 'ambiguous' && m.count === 2, 'two groups play the base animation and the entry picks neither: no group, and the reason is ambiguity');
  const picked = matchGroup(groups, { file: STAND, timeScale: 1, values: ['f'] }, null, 'mood');
  ok(picked.group !== null && picked.why === 'matched', 'the entry\'s own values break the tie');
}

// One clip per distinct animation, and the values of a branch that is the default under another
// name come back as `sameAsDefault` rather than as a clip.
{
  const group = {
    base: { file: STAND, timeScale: 1, values: ['default'], isDefault: true, label: 'default', differs: false },
    branches: [
      { file: STAND, timeScale: 1, values: ['default'], isDefault: true, label: 'default', differs: false },
      { file: STAND, timeScale: 1, values: ['calm', 'neutral'], isDefault: false, label: 'calm', differs: false },
      { file: 'a.ans', timeScale: 1, values: ['happy'], isDefault: false, label: 'happy', differs: true },
      { file: null, timeScale: 1, values: ['broken'], isDefault: false, label: 'broken', differs: false },
    ],
  };
  const { clips, sameAsDefault, unplayable } = moodClips(group as any, 'idle');
  ok(clips.length === 1 && clips[0].clip === 'idle:happy', 'one clip per distinct animation, named for its branch');
  ok(sameAsDefault.join(',') === 'default,calm,neutral' && unplayable.join(',') === 'broken', 'the values that play the base come back as such, and a branch naming no animation is kept apart');
}

// ---------------------------------------------------------------------------------------------
// Three of the mood branches are single poses, and a rig plays them as its idle, on repeat. A
// clip of one key has no length at all: three finishes such an action on its first update and a
// repeating one divides by that length and poses the bones at NaN. So every clip a rig bakes goes
// through the pad on its way out, exactly as a mobiles pack's always has.
{
  const q = (w: number, x: number, y: number, z: number) => new W().f32(w).f32(x).f32(y).f32(z);
  const skeleton = parseSkeleton(parseIff(Buffer.from(encode(form('SKTM', form('0002',
    chunk('INFO', new W().i32(2).bytes()),
    chunk('NAME', new W().str('root').str('child').bytes()),
    chunk('PRNT', new W().i32(-1).i32(0).bytes()),
    chunk('RPRE', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
    chunk('RPST', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
    chunk('BPTR', new W().f32(0).f32(0).f32(0).f32(0).f32(1).f32(0).bytes()),
    chunk('BPRO', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
    chunk('JROR', new W().u32(0).u32(0).bytes()))))))) as any;
  const pose = (frames: number) => ({
    version: 3, fps: 30, frameCount: frames,
    transforms: [
      { name: 'root', animatedRotation: false, rotationIndex: 0, translationMask: 0, xIndex: 0, yIndex: 0, zIndex: 0 },
      { name: 'child', animatedRotation: true, rotationIndex: 0, translationMask: 0, xIndex: 0, yIndex: 0, zIndex: 0 },
    ],
    rotationChannels: [Array.from({ length: frames }, (_, f) => ({ frame: f, q: [1, 0, f / (frames * 4), 0] }))],
    staticRotations: [[1, 0, 0, 0]], translationChannels: [], staticTranslations: [0, 0, 0], locomotionSpeed: 0,
  });
  // Neither name loops, so `skinData`'s own loop-closing leaves both alone and the pad is the
  // only thing under test here.
  const skin = skinData(skeleton, [{ name: 'still_pose', animation: pose(1) }, { name: 'swing', animation: pose(4) }]);
  ok(skin.clips[0].duration === 0, 'baked on its own, a single-pose clip has no length at all -- which is the reason for the pad');
  skin.clips.forEach((clip: any) => padSingleFrame(clip, 30));
  ok(skin.clips[0].times.length === 2 && Math.abs(skin.clips[0].duration - 1 / 30) < 1e-9, 'padded, it is held for one frame and an action playing it has a clock');
  ok(skin.clips[0].tracks.every((t: any) => t.rotations.length === 8 && t.rotations[0] === t.rotations[4] && t.translations.length === 6), 'both of its keys are the pose itself, so nothing moves');
  ok(skin.clips[1].times.length === 4 && Math.abs(skin.clips[1].duration - 3 / 30) < 1e-6, 'a clip of more than one key is left exactly as it was');
}

console.log(`\n${checks} checks passed`);
