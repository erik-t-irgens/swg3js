// The gesture every line of a conversation is said with (src/story/gestures.ts), and the gestures a speaker is
// lent for it (src/world/gestureLender.ts).
//
// What is pinned:
//
//   - the rule is a pure function of the line: the same line plays the same gesture every time, in every
//     browser, with nothing sent between them;
//   - a hand-picked slot wins (a clip, an alias, a family, a mood, or none), and an automatic one is filled
//     only where the slot was left out;
//   - the same clip is never played twice running, the speaker rests between gestures unless the cue is
//     strong, and somebody seated, lying, dead or held gestures not at all;
//   - only clips the body has are chosen, and stillness -- the speaker's mood idle -- is a chosen gesture;
//   - over five thousand synthetic lines, the share of each kind of line that gestures is within 0.03 of the
//     rate the tune gives it (the NGE's own measured rates);
//   - the families: a tone, a stage direction, a keyword, a mark, a long line, a mood, and a diction turning a
//     greeting into a salute or a bow;
//   - the player answers with a nod, a shake of the head or a thank, and otherwise not at all;
//   - every clip the families and aliases name is on the humanoid body's own list (read off the owner's
//     converted rig when this machine has one; skipped, and said, when it has not);
//   - a speaker is lent every gesture of a rig already parsed, its own species' first, and nothing before one is.
//
// Synthetic, but for the rig's clip list when it is there. Nothing of the game's files is written anywhere.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GESTURE_ALIASES, GESTURE_FAMILIES, GESTURE_TUNE, dictionOf, familyOf, gestureClips, newGestureMemory, pickGesture, rateOf, readSlot, rememberGesture, replyGesture, tuneGestures, wordCount, type GestureLine, type GestureSpeaker } from '../../../src/story/gestures.ts';
import { gesturesOf, lendGestures } from '../../../src/world/gestureLender.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (msg: string): void => console.log(`     ${msg}`);

const everything: GestureSpeaker = { still: false, has: () => true };
const line = (text: string, i = 0, more: Partial<GestureLine> = {}): GestureLine => ({ tree: 'test:talk/t', node: 'n', line: i, text, ...more });

// ---- the same line, the same gesture --------------------------------------------------------------------------
{
  const a = pickGesture(line('TEST: hello there, welcome to the town.', 3), everything, newGestureMemory());
  const b = pickGesture(line('TEST: hello there, welcome to the town.', 3), everything, newGestureMemory());
  ok(a.clip === b.clip && a.kind === b.kind && a.family === 'greet', `the same line gives the same gesture every time (${a.clip ?? 'still'}, ${a.family})`);
  let differ = 0;
  for (let i = 0; i < 40; i++) if (pickGesture(line('TEST: hello, welcome.', i), everything, newGestureMemory()).clip !== a.clip) differ++;
  ok(differ > 0, 'and another line of the same words may give another: the seed is the tree, the node and the line');
}

// ---- a slot filled by hand -------------------------------------------------------------------------------------
{
  const m = newGestureMemory();
  ok(pickGesture(line('TEST: words', 0, { slot: null }), everything, m).kind === 'none', 'a slot written null is none');
  const clip = pickGesture(line('TEST: words', 0, { slot: 'emt_bow2' }), everything, m);
  ok(clip.kind === 'hand' && clip.clip === 'emt_bow2', 'a clip by hand is that clip');
  ok(pickGesture(line('TEST: words', 0, { slot: 'nod_head_once' }), everything, m).clip === 'emt_nod_head_once', 'and so is a clip named without its emt_');
  const alias = pickGesture(line('TEST: words', 0, { slot: 'explain' }), everything, m);
  ok(alias.kind === 'hand' && (alias.clip === 'emt_conversation_1' || alias.clip === 'emt_conversation_2'), `an alias the game's own scripts used is its clip (explain: ${alias.clip})`);
  const fam = pickGesture(line('TEST: words', 0, { slot: '@agree' }), everything, m);
  ok(fam.kind === 'hand' && GESTURE_FAMILIES.agree.includes(fam.clip!), `a family by hand is a pick within it (${fam.clip})`);
  const mood = pickGesture(line('TEST: words', 0, { slot: 'mood:sad' }), everything, m);
  ok(mood.kind === 'mood' && mood.mood === 'sad' && mood.clip === null, 'a mood changes the idle for the rest of the conversation, and plays no clip of its own');
  ok(pickGesture(line('TEST: words', 0, { slot: 'emt_bow2' }), { still: false, has: (c) => c !== 'emt_bow2' }, m).kind === 'still', 'a clip by hand the body has not got is stillness, never another clip');
  ok(readSlot('@nonsense') === null && readSlot('emt_stand_ag') === null && readSlot('<b>') === null && readSlot('mood:') === null, 'a family that is not one, an ambient idle and anything else are no gesture');
}

// ---- the body's own gates, and the rule's memory ----------------------------------------------------------------
{
  const seated: GestureSpeaker = { still: true, has: () => true };
  ok(pickGesture(line('TEST: hello and welcome!'), seated, newGestureMemory()).kind === 'still' && pickGesture(line('TEST: words', 0, { slot: 'emt_bow2' }), seated, newGestureMemory()).kind === 'still', 'somebody seated gestures not at all, by the rule or by hand');
  ok(pickGesture(line('TEST: hello and welcome!'), { still: false, has: () => true, mood: 'npc_sitting_chair' }, newGestureMemory()).kind === 'still', 'nor does a speaker stood in a sitting mood');
  const limited: GestureSpeaker = { still: false, has: (c) => c === 'emt_wave1' };
  const was = GESTURE_TUNE.every;
  tuneGestures({ every: true });
  const m = newGestureMemory();
  const first = pickGesture(line('TEST: hello and welcome', 0), limited, m);
  rememberGesture(m, first);
  const second = pickGesture(line('TEST: hello and welcome', 1), limited, m);
  ok(first.clip === 'emt_wave1' && second.clip === null && second.kind === 'still', 'only a clip the body has is chosen, and never the same clip twice running: with none other, the speaker stands still');
  let repeats = 0;
  let last: string | null = null;
  const mem = newGestureMemory();
  for (let i = 0; i < 400; i++) {
    const p = pickGesture(line(i % 2 ? 'TEST: yes, of course' : 'TEST: hello there', i), everything, mem);
    rememberGesture(mem, p);
    if (p.clip && p.clip === last) repeats++;
    if (p.clip) last = p.clip;
  }
  ok(repeats === 0, 'over four hundred lines that all move, no clip is played twice running');
  tuneGestures({ every: was });
  const rest = newGestureMemory();
  rememberGesture(rest, { clip: 'emt_nod', kind: 'auto', family: 'agree', why: '' });
  const quiet = pickGesture(line('TEST: an ordinary remark of no note.', 5), everything, rest);
  ok(quiet.kind === 'still' && /resting/.test(quiet.why), 'after a gesture the next line rests, unless its cue is strong');
  let strongAfter = 0;
  for (let i = 0; i < 200; i++) if (pickGesture(line('TEST: ha ha, that is funny', i), everything, { last: 'emt_nod', since: 0 }).clip) strongAfter++;
  ok(strongAfter > 30, `a laugh does not wait its turn (${strongAfter} of 200 laughs right after a gesture moved)`);
}

// ---- the rates, over five thousand lines ---------------------------------------------------------------------------
{
  const kinds: [string, (i: number) => string, number][] = [
    ['plain', (i) => `TEST: an ordinary remark about the weather number ${i} today.`, GESTURE_TUNE.base],
    ['exclaim', (i) => `TEST: what a remarkable remark number ${i}!`, GESTURE_TUNE.exclaim],
    ['question', (i) => `TEST: what is the remark number ${i}?`, GESTURE_TUNE.question],
    ['strong', (i) => `TEST: farewell then, number ${i}.`, GESTURE_TUNE.strong],
    ['short', (i) => `TEST ${i}.`, GESTURE_TUNE.short],
  ];
  for (const [kind, text, rate] of kinds) {
    let moved = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) if (pickGesture({ tree: `test:talk/${kind}`, node: `n${i % 37}`, line: i, text: text(i) }, everything, newGestureMemory()).clip) moved++;
    const share = moved / n;
    ok(Math.abs(share - rate) <= 0.03, `${kind} lines gesture ${share.toFixed(3)} of the time against the tune's ${rate} (1000 lines)`);
  }
  ok(rateOf('TEST: no.', 'refuse') === GESTURE_TUNE.strong && rateOf('Hm.', null) === GESTURE_TUNE.short && rateOf('TEST: quite a long ordinary remark here!', null) === GESTURE_TUNE.exclaim, 'a strong cue, a short line and an exclamation take their own rates');
  const was = GESTURE_TUNE.every;
  tuneGestures({ every: true });
  let all = 0;
  for (let i = 0; i < 200; i++) if (pickGesture(line(`TEST: an ordinary remark ${i}.`, i), everything, newGestureMemory()).clip) all++;
  ok(all === 200, '`every` makes every line move, for comparison');
  tuneGestures({ every: was, base: 2, gap: -3 });
  ok(GESTURE_TUNE.base === 1 && GESTURE_TUNE.gap === 0, 'a rate is held to a share and the rest to nought or more');
  tuneGestures({ base: 0.28, gap: 1 });
}

// ---- the families ---------------------------------------------------------------------------------------------------
{
  const plainSpeaker = {};
  ok(familyOf('TEST: anything at all', 'angry', plainSpeaker) === 'threat' && familyOf('TEST: anything at all', 'secret', plainSpeaker) === 'secret', 'the writer\'s tone comes first');
  ok(familyOf('TEST: *sigh* if you must.', null, plainSpeaker) === 'sad' && familyOf('TEST: *cough* excuse me.', null, plainSpeaker) === 'cough', 'then a stage direction');
  ok(familyOf('TEST: Thank you kindly.', null, plainSpeaker) === 'thanks' && familyOf('TEST: No, never.', null, plainSpeaker) === 'refuse' && familyOf('Yes, of course.', null, plainSpeaker) === 'agree' && familyOf('TEST: I warn you, watch yourself.', null, plainSpeaker) === 'threat', 'then the keywords');
  ok(familyOf('TEST: The cargo is late!', null, plainSpeaker) === 'emphatic' && familyOf('TEST: Is the cargo late?', null, plainSpeaker) === 'question', 'then a mark at the end');
  ok(familyOf(`TEST: ${'word '.repeat(30)}`, null, plainSpeaker) === 'explain' && familyOf('TEST: The cargo is late.', null, { mood: 'angry' }) === 'threat' && familyOf('TEST: The cargo is late.', null, {}) === null, 'then a long line explains, then the speaker\'s mood, and otherwise there is no cue');
  ok(familyOf('TEST: Hello there.', null, { diction: 'military' }) === 'salute' && familyOf('TEST: Farewell.', null, { diction: 'fancy' }) === 'bow' && familyOf('TEST: Hello there.', null, {}) === 'greet', 'a soldier\'s greeting is a salute and a noble\'s a bow');
  ok(dictionOf('imperial', 'dressed_imperial_officer_m') === 'military' && dictionOf('civilian', 'dressed_stormtrooper_assault_trooper_m') === 'stormtrooper' && dictionOf('civilian', 'dressed_noble_bothan_female_01') === 'fancy' && dictionOf('civilian', 'dressed_commoner_x') === null, 'a diction is read off the side and the body');
  ok(wordCount('TEST: *sigh* three more words') === 4 && wordCount('') === 0, 'a stage direction is not counted as words');
}

// ---- the player's own answer -----------------------------------------------------------------------------------------
{
  const has = () => true;
  ok(replyGesture('Yes, I will do it.', undefined, has) === 'emt_nod_head_once' && replyGesture('No. Absolutely not.', undefined, has) === 'emt_shake_head_no' && replyGesture('Thank you.', undefined, has) === 'emt_thank', 'the player nods to a yes, shakes their head to a no and thanks a thank');
  ok(replyGesture('Tell me more about the cargo.', undefined, has) === null && replyGesture('Hello there.', undefined, has) === null, 'and gestures at nothing else');
  ok(replyGesture('Tell me more.', 'emt_bow2', has) === 'emt_bow2' && replyGesture('Yes.', null, has) === null && replyGesture('Yes.', undefined, () => false) === null, 'a slot by hand wins, null is none, and a clip the body has not got is not played');
}

// ---- every clip the rule names is on the body's own list -----------------------------------------------------------------
{
  const clips = gestureClips();
  ok(clips.length > 50 && clips.every((c) => /^emt_[a-z0-9_]+$/.test(c) && !c.endsWith('_ag')), `the rule names ${clips.length} clips, every one an emote and none an ambient idle`);
  for (const a of Object.keys(GESTURE_ALIASES)) ok(GESTURE_ALIASES[a].every((c) => readSlot(c)?.kind === 'clips'), `the alias ${a} resolves to ${GESTURE_ALIASES[a].join(' or ')}`);
  const rig = fileURLToPath(new URL('../../../assets-private/characters/human_male/parts.json', import.meta.url));
  if (existsSync(rig)) {
    const list = new Set((JSON.parse(readFileSync(rig, 'utf8')) as { clips: string[] }).clips);
    const missing = clips.filter((c) => !list.has(c));
    ok(missing.length === 0, `every clip the families and aliases name is on the humanoid body's own list (${list.size} clips read; missing: ${missing.join(', ') || 'none'})`);
  } else note('no converted human_male rig on this machine: the clip names were not checked against the body\'s own list');
}

// ---- lending ---------------------------------------------------------------------------------------------------------------
{
  const clip = (name: string) => ({ name }) as never;
  const rig = [clip('emt_wave1'), clip('emt_bow2'), clip('emt_stretch_ag'), clip('loop_walk')];
  const g = gesturesOf(rig);
  ok(g.size === 2 && g.has('emt_bow2') && !g.has('emt_stretch_ag') && gesturesOf(rig) === g, 'a rig\'s gestures are its emotes but its ambient idles, worked out once a rig');
  let lent: ReadonlyMap<string, unknown> | null = null;
  let asked: string | undefined = 'none';
  const body = { humanoid: true, entry: { species: 'rodian_male' }, lendClips: (m: ReadonlyMap<string, unknown>) => void (lent = m) };
  const n = lendGestures(body as never, { parsedRigClips: (p) => ((asked = p), rig as never) });
  ok(n === 2 && lent === g && asked === 'rodian_male', 'a speaker is lent every gesture of a rig already parsed, asked for its own species first');
  ok(lendGestures({ ...body, humanoid: false } as never, { parsedRigClips: () => rig as never }) === 0 && lendGestures(body as never, { parsedRigClips: () => null }) === 0, 'nothing for a body not on the humanoid skeleton, nor before any rig is in');
}

console.log(`\n${checks} checks passed`);
