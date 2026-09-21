// Moods, checked without a browser. A mood is one word that writes two things -- the body's branch
// of the standing loop, and the mark on what you say -- and the two halves are
// deliberately not the same list, so most of what can go wrong here is one half quietly standing in
// for the other.
//
// The body half is driven on the **real rig**, built round a fixture that stands in for a converted
// pack: a plain idle, walk and run, a branch named for one mood, a branch two moods share (the converter
// names a shared branch for its first value and writes every value to the manifest), and a branch
// under another selector entirely, which must never be taken for a mood. What is checked there is
// what the design asked for: a mood with a branch poses the idle, a mood with none
// leaves the body alone and -- the part that is easy to get wrong -- leaves it alone *playing*,
// rather than holding an action three disabled when its fade-out finished.
//
// `rig.ts` reaches the parts character, which carries a parameter property node's type stripping
// refuses, and it is imported here without extensions; the rig takes one thing from that file and
// the test never loads a pack, so it is served from a stub and the extensions are filled in by the
// same resolve hook. Nothing is written; only counts are printed.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from 'three';

const charStub = 'export class Character { static async load() { throw new Error("no pack in a test"); } }';
const hook = `import { existsSync } from 'node:fs';
export async function resolve(s, c, next) {
  if (s === './character' || s === './character.ts' || s.endsWith('/player/character') || s.endsWith('/player/character.ts')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  if (s.startsWith('.') && !/\\.[a-z]+$/.test(s) && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(s + '.ts', c);
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));
void existsSync;

const { CharacterRig } = await import('../../../src/player/rig.ts');
const { MOOD_OFF, MOOD_TUNE, PLAYER_MOODS, cleanMoodName, findMood, isMoodOff, isMoodValue, moodDef, moodListLine, moodNames, moodNote, moodReport, moodTag, tuneMoods } = await import('../../../src/player/moods.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- the two tables, and the seven names that are in both -----------------------------------------

ok(PLAYER_MOODS.length === 11, `eleven moods are offered (${PLAYER_MOODS.length})`);
{
  const both = PLAYER_MOODS.filter((m) => m.body !== 'none' && m.chat).map((m) => m.id);
  ok(both.length === 7, `exactly seven of them are in both tables (${both.length})`);
  for (const name of ['sad', 'calm', 'neutral', 'worried', 'nervous', 'angry', 'happy']) {
    ok(both.includes(name), `${name} is one of the seven`);
  }
  const tableOnly = PLAYER_MOODS.filter((m) => m.body !== 'none' && !m.chat).map((m) => m.id);
  ok(tableOnly.length === 4, `and the other four are the animation table's alone, with no name of their own in the chat table (${tableOnly.join(', ')})`);
  ok(PLAYER_MOODS.every((m) => m.body !== 'none'), 'every offered mood is a value of the animation table; the rest of its forty values are performances and scene poses');
  ok(moodReport().inBoth.length === 7, 'and the readout says so too, which is what the console reports');
}

// --- the three answers the animation table gives, which are not two ---------------------------------
//
// Ten of the table's forty values name the **default** branch: they are the plain breathing loop
// under another name, and four of the eleven offered here are among them. "This pack has no branch
// for it yet" and "there is no branch for it and a conversion will never make one" are therefore
// different answers, and this is where they are kept apart. The rule is exercised rather than the
// table read back: what is checked is the sentence each kind produces.
{
  const plain = PLAYER_MOODS.filter((m) => m.body === 'default').map((m) => m.id);
  ok(plain.join() === 'calm,neutral,threaten,conversation', `the four the table points at the default branch (${plain.join(', ')})`);
  const posed = PLAYER_MOODS.filter((m) => m.body === 'branch').map((m) => m.id);
  ok(posed.length === 7, `and seven a conversion can really pose (${posed.join(', ')})`);
  ok(posed.length + plain.length === PLAYER_MOODS.length, 'and between them they are every mood offered');
  for (const name of plain) {
    const note = moodNote(findMood(name), false);
    ok(!note.includes('not in this pack yet'), `${name} is never reported as waiting on a conversion, because no conversion can add it`);
    ok(note.includes('always did'), `and says instead that the game stands the same way in it (${note})`);
  }
  for (const name of posed) {
    ok(moodNote(findMood(name), false).includes('not in this pack yet'), `${name} does wait on the conversion, and says so`);
  }
  ok(moodReport().plain.length === 4 && moodReport().posed.length === 7, 'and the console readout counts both kinds apart');
}

// --- a pose is not a mood ---------------------------------------------------------------------------
//
// The same conversion that writes the mood branches writes the entertainers' performances and the
// scene NPCs' poses beside them, three of which are a single frame of a body lying dead. A player
// walking about must never be able to wear one: a mood is saved on the character and sent to
// everybody else, so one typed word would follow them for good and on every other screen too.
{
  for (const pose of ['npc_dead_01', 'npc_sitting_ground', 'npc_sitting_table', 'npc_standing_drinking', 'npc_meditate', 'npc_dance_basic', 'wookiee_lying_restrained', 'groove_01', 'themepark_music_1', 'fishing', 'default', 'ui', 'unnamed1']) {
    ok(!isMoodValue(pose), `${pose} is not a mood`);
    ok(findMood(pose, { body: [pose] }) === null, `and is refused although the pack carries it (${pose})`);
    ok(!moodNames({ body: [pose] }).includes(pose), `and is never offered by /mood (${pose})`);
  }
  for (const mood of ['angry', 'bored', 'entertained', 'wistful', 'grumpy_2']) {
    ok(isMoodValue(mood), `${mood} is a name a mood may have`);
  }
  const pack = ['angry', 'bored', 'npc_dead_01', 'npc_sitting_chair', 'groove_02', 'themepark_music_3', 'fishing'];
  const listed = moodNames({ body: pack });
  ok(listed.length === PLAYER_MOODS.length, `a real pack's values add nothing to the list but moods (${listed.length})`);
  ok(listed.every((n) => isMoodValue(n)), 'so what is listed and what is accepted are the same set');
}

// --- a name is a name ------------------------------------------------------------------------------

ok(cleanMoodName('  Angry ') === 'angry', 'a typed name is trimmed and read in lower case');
ok(cleanMoodName('npc_sitting_table') === 'npc_sitting_table', 'the table\'s own underscored values are names');
ok(cleanMoodName('groove_1') === 'groove_1', 'and so are the numbered ones');
ok(cleanMoodName('two words') === '', 'two words are not a mood');
ok(cleanMoodName('<b>angry</b>') === '', 'nor is anything that is not letters, digits and underscores, so nothing typed can ever reach the page as anything else');
ok(cleanMoodName('') === '' && cleanMoodName(null) === '' && cleanMoodName(7) === '', 'nothing, and anything that is not a word, is no mood at all');
ok(cleanMoodName('a'.repeat(200)).length === MOOD_TUNE.nameChars, 'a name longer than the cap is cut to it rather than refused outright');

// --- what a typed word means --------------------------------------------------------------------

ok(findMood('angry')?.id === 'angry', 'an offered mood is found');
ok(findMood('ANGRY')?.id === 'angry', 'however it was typed');
ok(moodDef('angry')?.chat === true, 'and it is one of the seven');
ok(findMood('wistful') === null, 'a name in neither table is refused');
ok(findMood('drop table') === null, 'and so is a line that is not a name');
{
  // A mood the pack carries that the offered list does not name is still a mood: the pack is the one
  // thing that knows what was really converted, and a later conversion of the chat table's own names
  // comes in the same way.
  const fromPack = findMood('smug', { body: ['smug'] });
  ok(fromPack?.id === 'smug' && fromPack.body === 'branch' && !fromPack.chat, 'a mood the pack carries is accepted although the offered list does not name it, and is one the body can pose');
  const fromChat = findMood('wistful', { chat: ['wistful'] });
  ok(fromChat?.id === 'wistful' && fromChat.body === 'none' && fromChat.chat, 'and so is one the chat table names and the animation table does not: it marks what you say and leaves the body alone');
  ok(moodNote(fromChat, false) === 'you are wistful', 'which says nothing about a pack, because no pack was ever going to have it');
  ok(findMood('smug_2', { body: ['smug'] }) === null, 'a name neither list holds is still refused');
}
ok(MOOD_OFF.every((w) => isMoodOff(w)), `each of ${MOOD_OFF.join(', ')} takes a mood off again`);
ok(!isMoodOff('angry'), 'and a mood is not one of them');

// --- what /mood says ------------------------------------------------------------------------------

{
  const line = moodListLine('angry', { body: ['angry'] });
  ok(line.includes('you are angry'), '/mood on its own says what mood you are in');
  ok(line.includes('calm') && line.includes('threaten'), 'and lists the moods there are');
  ok(line.includes('/mood none'), 'and how to take it off');
  ok(moodListLine('', null).includes('no mood'), 'with none set it says so');
  const many = moodNames({ body: Array.from({ length: 80 }, (_, i) => `mood_${i}`) });
  ok(many.length === 11 + 80, 'the list is the offered names and everything the pack adds');
  ok(many.slice(0, 11).join() === PLAYER_MOODS.map((m) => m.id).join(), 'the offered ones come first, in their own order');
  const capped = moodListLine('', { body: Array.from({ length: 80 }, (_, i) => `mood_${i}`) });
  ok(capped.includes('more'), 'and a pack with more moods than fit on a line says how many are left rather than filling the screen');
}
ok(moodNote(null, false) === 'you are in no mood at all now', 'taking a mood off says so');
ok(moodNote(findMood('angry'), true).includes('stand like it'), 'a mood the body took says the body took it');
ok(moodNote(findMood('angry'), false).includes('not in this pack yet'), 'and one it did not reads as "not yet", never as an error');
ok(!moodNote(findMood('angry'), false).toLowerCase().includes('error'), 'in those words exactly, because a pack converted before the moods is the ordinary case');

// --- the mark on what is said --------------------------------------------------------------------

ok(moodTag('angry') === ' (angry)', 'a mood is written after a speaker\'s name');
ok(moodTag('npc_sitting_table') === ' (npc sitting table)', 'and reads as words rather than as a key');
ok(moodTag('') === '', 'somebody in no mood is marked with nothing');
ok(moodTag('<b>x</b>') === '', 'and nothing that is not a name can be written after anybody\'s name');
{
  const was = MOOD_TUNE.chat;
  tuneMoods({ chat: 0 });
  ok(moodTag('angry') === '', 'the chat switch at nought leaves the chat line exactly as it was');
  tuneMoods({ chat: was });
  ok(moodTag('angry') === ' (angry)', 'and back');
}

// --- the tuning -------------------------------------------------------------------------------------

{
  const was = { ...MOOD_TUNE };
  tuneMoods({ nameChars: -5, listCap: 0, body: -1 });
  ok(MOOD_TUNE.nameChars >= 1 && MOOD_TUNE.listCap >= 1 && MOOD_TUNE.body >= 0, 'no number may go below what keeps the rules finite');
  tuneMoods(was);
  ok(MOOD_TUNE.nameChars === was.nameChars && MOOD_TUNE.body === was.body, 'and every number goes back where it was');
  ok(moodReport({ listCap: 5 }).tune.listCap === 5, 'the console moves what the game reads');
  tuneMoods(was);
}

// --- the body: a rig round a fixture that stands in for a converted pack ------------------------------

/** One clip that keeps a joint where it is: enough for the mixer to bind, play and blend it. */
function clip(name: string): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, [new THREE.QuaternionKeyframeTrack('joint.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
}

/**
 * A rig with the clips named, and the manifest's `variants` beside them. `idle:bored` is the shared
 * branch -- the converter names it for its first value and lists every value -- and `idle:o` is a
 * branch under another selector, which is in the fixture because a mood must never be read out of one.
 */
function rigWith(names: string[], variants: Record<string, { variable: string; values: string[] }> = {}) {
  const joint = new THREE.Bone();
  joint.name = 'joint';
  const group = new THREE.Group();
  group.add(joint);
  const character = { group, clips: names.map(clip) };
  return CharacterRig.fromCharacter(character as never, { variants });
}

/**
 * The walk branches are in the fixture on purpose and no real pack has any: the animation table's
 * mood selector hangs under the still branch alone, so there is no walking mood in the game's own
 * data to convert. They are here to pin that the game reads only the idle -- a rig handed a walk
 * branch must still walk plainly, or the day somebody writes one it would quietly start firing.
 */
const PACK = {
  'idle:angry': { variable: 'mood', values: ['angry'] },
  'walk:angry': { variable: 'mood', values: ['angry'] },
  'idle:bored': { variable: 'mood', values: ['bored', 'entertained'] },
  'walk:jaunty': { variable: 'mood', values: ['jaunty'] },
  'idle:o': { variable: 'gender', values: ['o'] },
};
const CLIPS = ['idle', 'walk', 'run', 'BOTH_STAND2', 'idle:angry', 'walk:angry', 'idle:bored', 'walk:jaunty', 'idle:o'];

/** A few frames of the mixer, so a crossfade is where it would be a third of a second later. */
const settle = (rig: ReturnType<typeof rigWith>, seconds = 0.3) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) rig.update(1 / 60);
};

{
  const rig = rigWith(CLIPS, PACK);
  const values = rig.moodValues();
  ok(values.includes('angry'), 'the pack\'s own mood values are read off its clips: angry');
  ok(values.includes('bored') && values.includes('entertained'), 'both values of a branch two moods share, out of the manifest rather than out of the clip\'s name');
  ok(!values.includes('o'), 'and nothing from a branch under another selector, which is not a mood however it is named');
  ok(!values.includes('jaunty'), 'and nothing off a walk branch: the mood selector hangs under the still branch alone, so a walking mood is a thing the game never had');
  ok(values.length === 3, `three values in all (${values.join(', ')})`);
  ok(findMood('entertained', { body: values })?.id === 'entertained', 'so /mood entertained is a mood this pack can pose');
}

{
  const rig = rigWith(CLIPS, PACK);
  rig.setState('idle');
  settle(rig);
  ok(rig.describe().clip === 'idle', 'with no mood the body stands in the plain idle');
  ok(rig.mood === '' && !rig.moodInBody, 'and says it is in none');

  ok(rig.setMood('angry') === true, 'a mood the pack has a branch for is taken by the body');
  settle(rig);
  ok(rig.describe().clip === 'idle:angry', 'and the idle is the mood\'s own');
  ok(rig.mood === 'angry' && rig.moodInBody, 'which it says');
  rig.setState('walk', 1.5);
  settle(rig);
  ok(rig.describe().clip === 'walk', 'and the walk is the plain walk, mood or no mood, although this fixture holds a walk branch the game never had');
  rig.setState('idle');
  settle(rig);

  // The branch two moods share: the value picks the branch through the manifest, not through its name.
  ok(rig.setMood('entertained') === true, 'a mood that shares a branch with another is taken too');
  settle(rig);
  ok(rig.describe().clip === 'idle:bored', 'and picks the branch the manifest lists it under, whatever that branch is named');
}

{
  // The rule the whole of package B turns on: a mood the pack has no branch for still *sets*, and
  // leaves the body playing the plain clip rather than an action that was faded out and disabled.
  const rig = rigWith(CLIPS, PACK);
  rig.setState('idle');
  settle(rig);
  rig.setMood('angry');
  settle(rig);
  ok(rig.describe().clip === 'idle:angry', 'the body is wearing a mood');
  ok(rig.setMood('worried') === false, 'a mood with no branch in this pack answers that the body did not take it');
  settle(rig);
  const back = rig.describe();
  ok(back.clip === 'idle', 'and the body goes back to the plain idle');
  ok(rig.mood === 'worried' && !rig.moodInBody, 'while still wearing the name, which is what the chat marks what you say with');
  ok((back.weights['idle'] ?? -100) >= 0, 'the idle is enabled: an action three disabled when its fade-out finished would show the bind pose for ever');
  ok((back.weights['idle'] ?? 0) > 0.9, `and is back at full weight (${(back.weights['idle'] ?? 0).toFixed(2)})`);

  rig.setMood(null);
  settle(rig);
  ok(rig.mood === '' && rig.describe().clip === 'idle', 'taking the mood off leaves the plain idle playing');
  ok((rig.describe().weights['idle'] ?? 0) > 0.9, 'at full weight');
}

{
  // A pack converted before the moods: nothing is there, nothing is an error, and the body is what it was.
  const rig = rigWith(['idle', 'walk', 'run', 'BOTH_STAND2']);
  rig.setState('idle');
  settle(rig);
  ok(rig.moodValues().length === 0, 'a pack with no moods in it carries no mood values');
  ok(rig.setMood('angry') === false, 'and a mood asked of it is not taken by the body');
  settle(rig);
  ok(rig.describe().clip === 'idle', 'which leaves the game exactly what it was');
  ok((rig.describe().weights['idle'] ?? 0) > 0.9, 'with the idle still playing at full weight');
  ok(rig.mood === 'angry', 'and the name still worn, so the chat half works with no conversion at all');
}

{
  // Combat is never affected: the mood is read by the idle and by nothing else.
  const rig = rigWith(CLIPS, PACK);
  rig.setMood('angry');
  rig.setState('stance');
  settle(rig);
  ok(rig.describe().clip === 'BOTH_STAND2', 'the saber stance is the stance, mood or no mood');
  rig.setState('run', 5.5);
  settle(rig);
  ok(rig.describe().clip === 'run', 'and the run is the run: the idle alone takes a mood');
}

{
  // The switch that makes the game exactly what it was.
  const was = MOOD_TUNE.body;
  const rig = rigWith(CLIPS, PACK);
  rig.setState('idle');
  tuneMoods({ body: 0 });
  ok(rig.setMood('angry') === false, 'with the body switch at nought a mood never reaches the body');
  settle(rig);
  ok(rig.describe().clip === 'idle', 'and the idle is the plain one');
  ok(rig.mood === 'angry', 'while the name is still worn for the chat');
  tuneMoods({ body: was });
  ok(rig.setMood('angry', true) === true, 'and asking again with the switch back on poses it');
  settle(rig);
  ok(rig.describe().clip === 'idle:angry', 'which is how the console switch takes effect on the mood already worn');
}

console.log(`${checks} checks passed`);
