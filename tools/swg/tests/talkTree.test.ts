// Conversations as data (src/story/talkSet.ts, src/story/talkRules.ts, played through the shared host loop in
// src/story/hostCore.ts), the server's half of them (server/stories.mjs), the cast stood in the world
// (src/world/storyStands.ts), and the checker's conversation rules (src/story/check.ts).
//
// What is pinned:
//
//   - the committed test set reads its two conversations and its three cast members, ids prefixed;
//   - entries are tried in order and the first whose condition holds is where a conversation starts, and the
//     last entry, which has none, is where everybody else starts: nobody is mute;
//   - an answer whose condition fails is hidden, or shown greyed with its reason; one chosen once is gone;
//     every node reached and every answer given is heard, and what `heard`, `chosen`, `met` and `named` read;
//     an answer is said in its own other words or its text, and one leading nowhere says it ends;
//   - an answer under pressure moves Trust once, a price is charged every time, a payment in a conversation is
//     paid once to a character (and settled once by a server it was paid away from), an introduction names the
//     speaker in the node shown, a node's own gesture goes on its first free line, an answer chooses a choice
//     step's option and the job goes on by it;
//   - a talk step is done when the speaker's conversation reaches its node, and the job's reward is paid once;
//   - a conversation revised in the middle of one starts again at its entry, and one that sets off a circle is
//     stopped with nothing kept;
//   - the browser's own host and the server give the same node views and leave the same book;
//   - a node crosses the wire and comes back the same, and the server keeps the rules a browser cannot be
//     trusted with: reach at every answer, the stand condition, its allowance a second (a close never counted,
//     and one over it answered at once), a conversation not its own;
//   - the server's host on the browser's side asks only a server that holds conversations, only for somebody
//     its view says has one, paces its openings and answers, and hands every node down to whoever listens;
//   - the checker refuses a mute conversation, a link to nowhere, a dead end, a ring of nodes with nothing said,
//     Trust outside pressure, a charge with no credits condition, a gesture that is not one, and a choice
//     nothing ever makes;
//   - the cast is stood near the player, kept between the near and far distances, taken down away from them,
//     and renamed when introduced.
//
// Synthetic, but for the committed test set, which is read as the game reads it. Nothing is read from the
// game's own files.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStorySet } from '../../../server/storySet.mjs';
import { STORY_TUNING, Stories, TALK_TOO_OFTEN, applyStory } from '../../../server/stories.mjs';
import { Purses } from '../../../server/purse.mjs';
import { applyChanges, cleanBook, cleanChange, emptyBook, type StoryBook } from '../../../src/story/book.ts';
import { checkSet } from '../../../src/story/check.ts';
import { HostCore, type HostCtx } from '../../../src/story/hostCore.ts';
import { CIRCLE, evalCond, rewardOfKey } from '../../../src/story/quests.ts';
import { REMOTE_TUNE, RemoteHost } from '../../../src/story/remoteHost.ts';
import { loadSet, stableText } from '../../../src/story/set.ts';
import type { NodeWord } from '../../../src/story/storyHost.ts';
import { cleanStoryWord, nodeWord } from '../../../src/story/storyWire.ts';
import { cleanNodeView, treeFor, type NodeView } from '../../../src/story/talkRules.ts';
import { cleanView, viewOf } from '../../../src/story/view.ts';
import { STAND_TUNE, StoryStands, type CastBody } from '../../../src/world/storyStands.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (msg: string): void => console.log(`     ${msg}`);
const same = (a: unknown, b: unknown): boolean => stableText(a) === stableText(b);

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const FILES = readStorySet(TESTSET).files;
const loaded = loadSet(FILES, { test: true });
const lib = loaded.set;
const CLERK = 'test:cast/test-clerk';
const DOOMED = 'test:cast/test-doomed';
const T0 = 1_800_000_000_000;
let clock = T0;
/** What is true just now: the test square on Tatooine, and as many credits as a case says. */
let credits = 100;
const ctx = (): HostCtx => ({ now: clock, world: 'tatooine', here: [3482, -4690], room: null, credits });
const hostOf = (book = emptyBook('char-1')) => new HostCore({ book, lib, payer: 'browser' });
const ids = (v: NodeView | null): string[] => v?.replies.map((r) => `${r.id}${r.enabled ? '' : '-'}`) ?? [];

// ---- the test set reads ----------------------------------------------------------------------------------
{
  ok(loaded.errors.length === 0, `the test set reads with no errors (${loaded.errors.map((e) => `${e.file}:${e.line} ${e.message}`).join('; ')})`);
  ok(Object.keys(lib.talks).sort().join() === 'test:talk/test-branching,test:talk/test-clerk' && Object.keys(lib.cast).length === 3, 'its two conversations and its three cast members, ids prefixed');
  const t = lib.talks['test:talk/test-clerk'];
  ok(/^[0-9a-f]{16}$/.test(t.hash) && t.speaker === CLERK && t.entry.length === 3 && !t.entry[2].when, 'a conversation carries its own hash, its speaker, and a last entry with no condition');
  ok(lib.cast[CLERK].tree === 'test:talk/test-clerk' && lib.cast[CLERK].essential && !lib.cast[DOOMED].essential && lib.cast[DOOMED].mortal, 'a cast member is essential unless mortal');
  ok(treeFor(lib, CLERK)?.id === 'test:talk/test-clerk' && treeFor(lib, 'test:cast/test-companion') === null && treeFor(lib, 'row:abc') === null, 'only a cast member with a tree of their own speaks one');
  const line = t.nodes.hello.say[0];
  ok(line.tone === 'warm' && line.gesture === undefined && line.shot === undefined && t.nodes.given.say[0].gesture === 'emt_nod_head_once' && t.nodes.named.say[0].shot?.kind === 'close-npc', 'a line left to the game keeps its slots absent; one filled by hand keeps them');
  const r = t.nodes.hello.replies.find((x) => x.id === 'bye')!;
  ok(r.said !== undefined && r.said !== null && r.to === null, "an answer said in other words keeps them, and one leading nowhere ends the conversation");
}

// ---- entries, hide and greyed, heard, the talk step, the reward ---------------------------------------------
{
  const h = hostOf();
  const a = h.talkOpen(CLERK, ctx());
  ok(a.turn.view?.node === 'hello' && a.turn.view.lines.length === 2 && a.turn.state?.speaker === CLERK, 'with nothing set, the conversation starts at its last entry, the one with no condition');
  ok(same(ids(a.turn.view), ['job', 'name', 'rich-', 'press', 'pay', 'bye']), `an answer whose condition fails and is shown greyed is listed greyed; the rest are open (${ids(a.turn.view).join(' ')})`);
  const rich = a.turn.view!.replies.find((x) => x.id === 'rich')!;
  ok(!rich.enabled && rich.why === 'TEST: you need a million credits' && a.turn.view!.replies.find((x) => x.id === 'press')!.stakes === 'TEST: the clerk will remember this', 'a greyed answer carries its reason, and an answer with something at stake says it');
  ok(!ids(a.turn.view).some((r) => r.startsWith('tip')) && treeFor(lib, CLERK)!.nodes.hello.replies.some((r) => r.id === 'tip' && !!r.when && r.show !== 'disable'), 'an answer whose condition fails and that says nothing of how to show it is not shown at all, not even greyed');
  const bye = a.turn.view!.replies.find((x) => x.id === 'bye')!;
  const job0 = a.turn.view!.replies.find((x) => x.id === 'job')!;
  ok(bye.said === 'TEST: Goodbye, then.' && bye.text === 'TEST: Goodbye.' && bye.ends === true && job0.said === job0.text && job0.ends === undefined, 'an answer is said aloud in its own other words where it has them, its text where not, and one leading nowhere says it ends the conversation');
  ok(h.book.heard?.['test:talk/test-clerk#hello'] === T0 && h.book.npcs?.[CLERK]?.met === T0 && h.book.flags?.['test.clerk.met'] === 1, 'reaching a node is heard, the speaker is met, and the node\'s own actions run');
  ok(a.turn.view!.name === 'TEST: a clerk', 'the speaker is known by what they are called until they give their name');
  credits = 5;
  const poor = h.talkOpen(CLERK, ctx());
  ok(poor.turn.view?.node === 'again' && poor.turn.view.next && poor.turn.view.replies.length === 0, 'with the flag set, the second entry holds and the conversation starts there, at a node that goes on by itself');
  const on = h.talkPick(poor.turn.state!, null, ctx());
  ok(on.turn.view?.node === 'hello' && ids(on.turn.view).includes('pay-'), 'going on reaches the next node, where ten credits short greys the price');
  credits = 100;
  clock += 1000;
  const job = h.talkPick(on.turn.state!, 'job', ctx());
  ok(job.turn.view?.node === 'given' && job.turn.view.end && h.book.quests?.['test:talk']?.state === 'active', 'an answer grants a job and leads to a node that ends');
  ok(h.book.heard?.['test:talk/test-clerk#hello.job'] !== undefined && evalCond({ chosen: 'test:talk/test-clerk#hello.job' }, h.book, { now: clock, char: 'char-1', payer: 'browser' }) && evalCond({ heard: 'test:talk/test-clerk#given' }, h.book, { now: clock, char: 'char-1', payer: 'browser' }), 'an answer given is heard too, and `heard` and `chosen` read them');
  const busy = h.talkOpen(CLERK, ctx());
  ok(busy.turn.view?.node === 'busy', 'while the job runs, the first entry holds');
  const done = h.talkPick(busy.turn.state!, 'done', ctx());
  ok(done.turn.view?.node === 'finished' && h.book.quests?.['test:talk']?.state === 'done' && done.r.pay.some((p) => p.credits === 5), 'reaching the node a talk step waits for finishes it, and the job\'s reward is paid');
  const busyAgain = h.talkOpen(CLERK, ctx());
  ok(busyAgain.turn.view?.node === 'again', 'and the job done, the clerk is back to the second entry');
  const afterJob = h.talkPick(busyAgain.turn.state!, null, ctx());
  ok(ids(afterJob.turn.view).includes('tip'), 'and the answer hidden until the job was done is offered now its condition holds');
  const refused = h.talkPick(a.turn.state!, 'rich', ctx());
  ok(refused.turn.why === 'that answer is not open' && refused.turn.state?.node === 'hello' && refused.r.ch.length === 0, 'a greyed answer chosen anyway is refused, changes nothing, and leaves the conversation where it was');
  const nowhere = h.talkPick(a.turn.state!, 'nonsense', ctx());
  ok(nowhere.turn.why === 'there is no such answer', 'an answer the node does not have is no answer');
}

// ---- pressure once, a price every time, an introduction ------------------------------------------------------
{
  const h = hostOf();
  const open = h.talkOpen(CLERK, ctx());
  const press = h.talkPick(open.turn.state!, 'press', ctx());
  ok(press.turn.view?.node === 'pressed' && h.book.tracks?.freelance?.trust === 1 && press.r.notes.every((n) => n.k !== 'standing'), 'an answer under pressure moves Trust, and says nothing of it on the message line');
  const again = h.talkPick(h.talkOpen(CLERK, ctx()).turn.state!, null, ctx());
  ok(again.turn.view?.node === 'hello' && !ids(again.turn.view).includes('press'), 'an answer chosen once is not offered again');
  const forced = h.talkPick(again.turn.state!, 'press', ctx());
  ok(forced.turn.why === 'that answer is not open' && h.book.tracks?.freelance?.trust === 1, 'and asked for anyway it is refused, so Trust moves once');
  const pay1 = h.talkPick(again.turn.state!, 'pay', ctx());
  const pay2 = h.talkPick(h.talkPick(h.talkOpen(CLERK, ctx()).turn.state!, null, ctx()).turn.state!, 'pay', ctx());
  ok(pay1.r.pay.length === 1 && pay1.r.pay[0].charge === 10 && pay2.r.pay[0]?.charge === 10 && pay1.r.notes.some((n) => n.k === 'charged'), 'a price is charged every time it is chosen, and said');
  const name = h.talkPick(h.talkPick(h.talkOpen(CLERK, ctx()).turn.state!, null, ctx()).turn.state!, 'name', ctx());
  ok(name.turn.view?.node === 'named' && name.turn.view.name === 'TEST CLERK' && h.book.npcs?.[CLERK]?.named !== undefined, 'an introduction names the speaker, and the very next node shows them by their name');
  const view = viewOf(h.book, lib, { now: clock, char: 'char-1', payer: 'browser' });
  ok(view.cast.find((c) => c.id === CLERK)?.name === 'TEST CLERK' && view.cast.find((c) => c.id === CLERK)?.named === true && view.cast.length === 3, 'and the view of the cast to stand calls them by it too');
  const off = cleanView(JSON.parse(JSON.stringify(view)));
  ok(!!off && same(off.cast, view.cast), 'the cast crosses the wire in a view unchanged');
}

// ---- met and named, read as conditions ----------------------------------------------------------------------------
{
  const h = hostOf();
  const at = { now: clock, char: 'char-1', payer: 'browser' as const };
  const met = { person: { who: CLERK, is: 'met' } };
  const named = { person: { who: CLERK, is: 'named' } };
  ok(!evalCond(met, h.book, at) && !evalCond(named, h.book, at), 'before the first word nobody is met or named');
  const open = h.talkOpen(CLERK, ctx());
  ok(evalCond(met, h.book, at) && !evalCond(named, h.book, at) && !evalCond({ person: { who: DOOMED, is: 'met' } }, h.book, at), 'opening a conversation meets the speaker and nobody else, and names nobody');
  h.talkPick(open.turn.state!, 'name', ctx());
  ok(evalCond(named, h.book, at) && evalCond(met, h.book, at), 'an introduction names them');
  ok(!evalCond({ person: { who: CLERK, is: 'liked' } }, h.book, at), 'and anything else asked of a person is a later wave\'s, and does not hold');
}

// ---- a payment in a conversation is paid once to a character, Trust moved once, and the node's own gesture worn -------
{
  const h = hostOf();
  h.grant('test:talk', ctx());
  h.talkPick(h.talkOpen(CLERK, ctx()).turn.state!, 'done', ctx());
  const hello = () => h.talkPick(h.talkOpen(CLERK, ctx()).turn.state!, null, ctx());
  const first = hello();
  const tip1 = h.talkPick(first.turn.state!, 'tip', ctx());
  const tip2 = h.talkPick(hello().turn.state!, 'tip', ctx());
  ok(tip1.turn.view?.node === 'tipped' && tip2.turn.view?.node === 'tipped', 'an answer that is not chosen once is offered and taken again');
  ok(tip1.r.pay.length === 1 && tip1.r.pay[0].credits === 3 && tip1.r.pay[0].key === 'test:talk/test-clerk#1#do:hello.tip.0' && tip2.r.pay.length === 0 && tip1.r.notes.some((n) => n.k === 'paid' && n.credits === 3) && !tip2.r.notes.some((n) => n.k === 'paid'), 'but what it pays is paid the first time only, keyed by the conversation and where the action is written');
  ok(h.book.tracks?.freelance?.trust === 1, 'and the Trust it moves under pressure moves once');
  ok(tip1.turn.view!.lines[0].gesture === 'emt_bow2' && lib.talks['test:talk/test-clerk'].nodes.tipped.say.every((l) => l.gesture === undefined), "a node's own gesture action goes on its first line the tree leaves to the game");
  const k = rewardOfKey('test:talk/test-clerk#1#do:hello.tip.0', lib);
  ok(k?.talk === true && k.credits === 3 && rewardOfKey('test:talk/test-clerk#1#do:hello.tip.1', lib)?.credits === 0, "the key reads back off the answer's own actions: three credits from the first, nothing from the Trust after it");
  // A browser that paid it with nobody holding the book: the server settles it once, from its own set's amount.
  const settler = new Stories({ tuning: STORY_TUNING, write: () => {}, now: () => clock, read: () => ({ test: FILES, own: null }), tests: true });
  settler.readSets();
  const key = 'test:talk/test-clerk#1#do:hello.tip.0';
  const offered = { ...emptyBook('char-s'), paid: { [key]: { at: clock, by: 'browser' } } };
  const owed = settler.settleOwed(offered, null) as { credits: number; keys: number };
  ok(owed.credits === 3 && owed.keys === 1 && offered.paid[key].by === 'settle', 'a conversation\'s payment a browser made alone is owed by the server at its settle, once');
  const again = settler.settleOwed(offered, null) as { credits: number; keys: number };
  ok(again.credits === 0 && again.keys === 0, 'and settled again it is owed nothing more');
}

// ---- a choice made in a conversation ------------------------------------------------------------------------
{
  const right = hostOf();
  right.grant('test:choice', ctx());
  const open = right.talkOpen(DOOMED, ctx());
  ok(open.turn.view?.node === 'choose' && same(ids(open.turn.view), ['left', 'right']) && open.turn.view.replies[1].stakes === 'TEST: the right is the harder way', 'while the choice job runs, the doomed one asks which way');
  right.talkPick(open.turn.state!, 'right', ctx());
  const q = right.book.quests?.['test:choice'];
  ok(q?.state === 'done' && q.outcome === 'right' && q.steps.decide.choice === 'right' && right.book.tracks?.freelance?.trust === 1, 'an answer chooses the option, whose own end ends the job, and an option under pressure moves Trust');
  ok(evalCond({ choice: ['test:choice', 'decide'], eq: 'right' }, right.book, { now: clock, char: 'x', payer: 'browser' }) && !evalCond({ choice: ['test:choice', 'decide'], eq: 'left' }, right.book, { now: clock, char: 'x', payer: 'browser' }), '`choiceOf` reads the option chosen');
  const left = hostOf();
  left.grant('test:choice', ctx());
  left.talkPick(left.talkOpen(DOOMED, ctx()).turn.state!, 'left', ctx());
  const l = left.book.quests?.['test:choice'];
  ok(l?.state === 'done' && l.outcome === 'left' && l.steps.went_left?.state === 'done' && (left.book.tracks?.freelance?.trust ?? 0) === 0, 'the other goes on by its own edge, to the step that ends the job its way');
  const k = rewardOfKey('test:talk/test-clerk#1#do:hello.pay.0', lib);
  ok(k?.talk === true && k.credits === 0 && rewardOfKey('test:talk/test-clerk#2#do:hello.pay.0', lib) === null && rewardOfKey('test:talk/test-clerk#1#do:nowhere.0', lib) === null, 'a conversation\'s key reads back off its own answer, once to a character, and one it cannot read pays nothing');
}

// ---- a tree revised in the middle of a conversation --------------------------------------------------------------
{
  const h = hostOf();
  const open = h.talkOpen(CLERK, ctx());
  const edited = FILES.map((f) => (f.path === 'talk/test-clerk.jsonc' ? { ...f, text: f.text.replace('"rev": 1', '"rev": 2').replace("This is the test clerk's first line.", "This is the test clerk's first line, revised.") } : f));
  const lib2 = loadSet(edited, { test: true }).set;
  ok(lib2.talks['test:talk/test-clerk'].hash !== lib.talks['test:talk/test-clerk'].hash, 'an edit changes the conversation\'s hash');
  h.setLibrary(lib2, ctx());
  const r = h.talkPick(open.turn.state!, 'name', ctx());
  ok(r.turn.restarted === true && r.turn.view?.node === 'again' && h.book.npcs?.[CLERK]?.named === undefined, 'an answer to the old tree is not given: the conversation starts again at its entry, where the flag now sends it');
}

// ---- the book's two sections, cleaned ---------------------------------------------------------------------
{
  const b = emptyBook('char-1');
  const r = applyChanges(b, [
    { k: 'heard', key: 'test:talk/test-clerk#hello', at: 5 },
    { k: 'heard', key: 'test:talk/test-clerk#hello', at: 9 },
    { k: 'npcMet', who: CLERK, at: 5 },
    { k: 'npcMet', who: CLERK, at: 7, named: true },
    { k: 'npcMet', who: 'row:0badf00d', at: 8 },
    { k: 'trackAdd', track: 'freelance', standing: 0, trust: 2 },
  ]);
  ok(r.applied.length === 5 && r.refused.length === 1 && b.heard!['test:talk/test-clerk#hello'] === 5 && b.npcs![CLERK].met === 5 && b.npcs![CLERK].named === 7 && b.tracks!.freelance!.trust === 2, 'a node is heard the first time only, a person met and then named, and Trust added');
  ok(cleanChange({ k: 'heard', key: '__proto__', at: 1 }) === null && cleanChange({ k: 'npcMet', who: 'constructor', at: 1 }) === null && cleanChange({ k: 'heard', key: 'test:talk/x#a.b.c', at: 1 }) === null && cleanChange({ k: 'trackAdd', track: 'freelance', standing: 0, trust: Number.NaN }) === null, 'what is not a node, a person or a number is no change');
  const back = cleanBook(JSON.parse(JSON.stringify({ ...b, npcs: { ...b.npcs, [CLERK]: { ...b.npcs![CLERK], later: 'kept' }, nonsense: { met: 1 } } })));
  ok(!!back && back.npcs![CLERK].named === 7 && back.npcs![CLERK].later === 'kept' && !('nonsense' in back.npcs!) && back.heard!['test:talk/test-clerk#hello'] === 5, 'read back, both sections are rebuilt: what a later wave keeps on a person stays, what is not a person goes');
}

// ---- the checker's conversation rules ------------------------------------------------------------------------------
{
  const head = { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' };
  const cast = { path: 'cast/c.jsonc', text: JSON.stringify({ id: 'c', name: 'TEST C', body: 'x', world: 'tatooine', at: [0, 0], tree: 'talk/t' }) };
  const tree = (nodes: Record<string, unknown>, entry: unknown[] = [{ to: 'a' }]) => ({ path: 'talk/t.jsonc', text: JSON.stringify({ format: 1, id: 't', entry, nodes }) });
  const run = (...files: { path: string; text: string }[]) => checkSet(loadSet([head, cast, ...files]));
  const has = (r: ReturnType<typeof run>, rule: number, re: RegExp) => r.errors.some((e) => e.rule === rule && re.test(e.message));
  const fine = run(tree({ a: { say: ['TEST'], end: true } }));
  ok(fine.errors.length === 0, `a plain conversation passes (${fine.errors.map((e) => e.message).join('; ')})`);
  ok(has(run(tree({ a: { say: ['TEST'], end: true } }, [{ when: 'flag(x)', to: 'a' }])), 12, /mute/), 'a last entry with a condition is refused: nobody is ever mute');
  ok(has(run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', to: 'b' }] } })), 12, /not a node/), 'an answer leading to a node that is not there is refused');
  ok(has(run(tree({ a: { say: ['TEST'] } })), 12, /neither ends/), 'a node that neither ends, goes on nor offers an answer is refused');
  ok(run(tree({ a: { say: ['TEST'], end: true }, lost: { say: ['TEST'], end: true } })).warnings.some((w) => w.rule === 12 && /never reached/.test(w.message)), 'a node nothing reaches is warned about');
  ok(has(run(tree({ a: { say: ['TEST'], do: ['trust(freelance, 1)'], end: true } })), 5, /pressure/), 'Trust moved as a node is reached is refused');
  ok(has(run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', do: ['trust(freelance, 1)'] }] } })), 5, /pressure/) && !run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', pressure: true, do: ['trust(freelance, 1)'] }] } })).errors.length, 'Trust on an answer not under pressure is refused, and under pressure is not');
  ok(has(run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', do: ['charge(10)'] }] } })), 9, /credits/) && !run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', when: 'credits() >= 10', do: ['charge(10)'] }] } })).errors.length, 'a charge with no credits condition is refused, and one with it is not');
  ok(has(run(tree({ a: { say: [{ text: 'TEST', gesture: '@nofamily' }], end: true } })), 4, /not a gesture/) && !run(tree({ a: { say: [{ text: 'TEST', gesture: 'explain' }, { text: 'TEST', gesture: '@agree' }, { text: 'TEST', gesture: 'mood:sad' }, { text: 'TEST', gesture: null }], end: true } })).errors.length, 'a gesture that is not one is refused; a clip by its alias, a family, a mood and none are all gestures');
  const withClips = checkSet(loadSet([head, cast, tree({ a: { say: [{ text: 'TEST', gesture: 'emt_not_on_this_body' }], end: true } })]), { clips: new Set(['emt_nod']) });
  ok(withClips.warnings.some((w) => /not one of the body/.test(w.message)), 'with the body\'s clip list in hand, a clip it has not got is warned about');
  const choiceQuest = { path: 'quests/q.jsonc', text: JSON.stringify({ id: 'q', title: 'TEST', givers: [{ kind: 'debug' }], start: ['c'], steps: { c: { type: 'choice', options: [{ id: 'x', label: 'TEST', ends: 'done' }] } } }) };
  ok(has(run(tree({ a: { say: ['TEST'], end: true } }), choiceQuest), 3, /choice nothing ever makes/), 'a choice step nothing ever chooses is refused');
  ok(!run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', do: ['choose(q, c, x)'] }] } }), choiceQuest).errors.length, 'and one an answer chooses is not');
  ok(has(run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', do: ['choose(q, c, y)'] }] } }), choiceQuest), 1, /no option y/), 'an answer choosing an option the choice has not got is refused');
  const talkQuest = (node: string) => ({ path: 'quests/t.jsonc', text: JSON.stringify({ id: 't', title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], steps: { s: { type: 'talk', who: 'cast/c', node, ends: 'done' } } }) });
  ok(!run(tree({ a: { say: ['TEST'], end: true } }), talkQuest('a')).errors.length && has(run(tree({ a: { say: ['TEST'], end: true } }), talkQuest('zz')), 12, /no node zz/), 'a talk step waits on a node its speaker\'s conversation has, and one it has not is refused');
  ok(has(run(tree({ a: { say: ['TEST'], end: true } }), talkQuest('zz')), 3, /nothing raises/), 'and is a signal nothing raises');
  ok(has(run(tree({ a: { say: ['TEST'], end: true, do: ['introduce(cast/nobody)'] } })), 1, /no cast member/) && run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', when: 'heard(a.r)' }] } })).errors.some((e) => /node is written/.test(e.message)), 'an introduction names somebody of the cast, and a node is written as a node');
  ok(has(run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', when: 'heard(talk/t#zz)' }] } })), 12, /no node zz/) && !run(tree({ a: { say: ['TEST'], replies: [{ id: 'r', text: 'TEST', when: 'heard(a) && chosen(a.r)' }] } })).errors.length, 'a node or an answer `heard` and `chosen` name must be there, in this conversation or another');
  ok(has(checkSet(loadSet([head, { path: 'cast/c.jsonc', text: JSON.stringify({ id: 'c', name: 'TEST C', body: 'x', world: 'tatooine', at: [0, 0], tree: 'talk/missing' }) }])), 12, /no conversation/), 'a cast member whose conversation is not there is refused');
  const ring = run(tree({ a: { say: ['TEST'], next: 'b' }, b: { next: 'c' }, c: { next: 'b' } }));
  ok(has(ring, 12, /b -> c -> b go on to each other with nothing said/) && ring.errors.filter((e) => /nothing said/.test(e.message)).length === 1, `nodes that go on to each other in a ring with nothing said and no answer offered are refused, the ring said once (${ring.errors.map((e) => e.message).join('; ')})`);
  const self = run(tree({ a: { next: 'a' } }));
  ok(has(self, 12, /a -> a go on/), 'and so is a node that only goes on to itself');
  const talky = run(tree({ a: { say: ['TEST'], next: 'b' }, b: { next: 'a' } }));
  ok(!talky.errors.some((e) => /nothing said/.test(e.message)) && talky.warnings.some((w) => /b says nothing and only goes on to a/.test(w.message)), 'a ring with a line in it is no such ring, but a node in it that says nothing and only goes on is warned about');
  ok(!run(tree({ a: { replies: [{ id: 'r', text: 'TEST', to: 'a' }], next: 'a' } })).errors.some((e) => /nothing said/.test(e.message)), 'nor is a node that offers an answer, whose own `next` is never taken');
}

// ---- a circle set off by a conversation is stopped, and nothing it did is kept ---------------------------------------
{
  const head = { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' };
  const cast = { path: 'cast/c.jsonc', text: JSON.stringify({ id: 'c', name: 'TEST C', body: 'x', world: 'tatooine', at: [0, 0], tree: 'talk/t' }) };
  const t = { path: 'talk/t.jsonc', text: JSON.stringify({ format: 1, id: 't', entry: [{ to: 'a' }], nodes: { a: { say: ['TEST'], do: ['grant(own:circle)'], end: true } } }) };
  const circle = { path: 'quests/circle.jsonc', text: JSON.stringify({ id: 'circle', title: 'TEST', givers: [{ kind: 'debug' }], start: ['a'], steps: { a: { type: 'nothing', loop: true, next: ['b'] }, b: { type: 'nothing', loop: true, next: ['a'] } } }) };
  const own = loadSet([head, cast, t, circle]);
  ok(own.errors.length === 0, `a conversation that sets off a circle reads (${own.errors.map((e) => e.message).join('; ')})`);
  const h = new HostCore({ book: emptyBook('char-o'), lib: own.set, payer: 'browser' });
  const rev = h.book.rev;
  const r = h.talkOpen('own:cast/c', ctx());
  ok(r.turn.why === CIRCLE && r.turn.view === null && r.turn.state === null, 'opening it is stopped as any event is: no node, and the circle said as why');
  ok(r.r.ch.length === 0 && r.r.pay.length === 0 && h.book.rev === rev && !h.book.heard?.['own:talk/t#a'] && !h.book.npcs?.['own:cast/c'], 'and nothing it did is kept: not the node heard, not the person met');
}

// ---- the server's host on the browser's side ---------------------------------------------------------------------
{
  const sent: Record<string, unknown>[] = [];
  const line = { host: 'server' as 'local' | 'server' | 'held', story: 2 };
  let wall = 10_000;
  const remote = new RemoteHost({ send: (m) => sent.push(m), line: () => line, char: () => 'char-r', at: () => ({ p: [1, 2], room: null }), now: () => clock, wall: () => wall, note: () => {} });
  const got: NodeWord[] = [];
  remote.onNode((n) => got.push(n));
  ok(!remote.canTalk(CLERK) && !remote.talk('open', CLERK).ok && sent.length === 0, 'a server whose hail says less than 3 is never asked for a conversation: the window falls back on the game\'s own greeting there');
  line.story = 3;
  ok(!remote.canTalk(CLERK), 'nor one that says 3 before its view has said who has something to say');
  const h = hostOf();
  const view = viewOf(h.book, lib, { now: clock, char: 'char-r', payer: 'browser' });
  remote.word({ t: 'story', do: 'view', view, off: 0 });
  ok(remote.canTalk(CLERK) && !remote.canTalk('test:cast/test-companion') && !remote.canTalk('test:cast/nobody'), 'then it is asked for somebody its view says has a conversation, never for one of the story\'s people with none');
  ok(remote.talk('open', CLERK).ok && sent.length === 1 && sent[0].do === 'talk' && sent[0].op === 'open' && sent[0].speaker === CLERK && !!sent[0].at, 'an opening goes up at once, with where the player stood');
  remote.talk('pick', CLERK, 'job');
  ok(sent.length === 1 && (remote.report().queued as number) === 1, `an answer straight after it waits its turn rather than being refused there (${REMOTE_TUNE.talkGap} ms apart)`);
  remote.talk('close', CLERK);
  ok(sent.length === 1, 'and so does what was said after it, in order');
  wall += REMOTE_TUNE.talkGap;
  remote.tick();
  ok(sent.length === 3 && sent[1].op === 'pick' && sent[1].reply === 'job' && sent[2].op === 'close', 'once the gap has passed the answer goes, and the close behind it at once');
  remote.talk('close', CLERK);
  ok(sent.length === 4, 'a close on its own is never held back');
  const opened = h.talkOpen(CLERK, ctx()).turn.view!;
  remote.word(JSON.parse(JSON.stringify(nodeWord(CLERK, opened, null))));
  ok(got.length === 1 && got[0].speaker === CLERK && same(got[0].view, opened) && !got[0].why,'a node the server reached is handed to whoever listens, as the browser\'s own host hands its own');
  remote.word(JSON.parse(JSON.stringify(nodeWord(CLERK, null, TALK_TOO_OFTEN))));
  ok(got.length === 2 && got[1].view === null && got[1].why === TALK_TOO_OFTEN, 'and so is a refusal, with no node and why');
}

// ---- the wire ------------------------------------------------------------------------------------------------------
{
  const h = hostOf();
  const v = h.talkOpen(CLERK, ctx()).turn.view!;
  const word = JSON.parse(JSON.stringify(nodeWord(CLERK, v, null)));
  const back = cleanStoryWord(word, 'down');
  ok(back?.do === 'node' && same(back.view, v), 'a node crosses the wire as the word\'s own fields and comes back the same');
  const none = cleanStoryWord(JSON.parse(JSON.stringify(nodeWord(CLERK, null, 'they have nothing to say'))), 'down');
  ok(none?.do === 'node' && none.view === null && none.why === 'they have nothing to say', 'and an end, or a refusal, as none with why');
  ok(cleanNodeView({ ...word, speaker: '__proto__' }) === null && cleanNodeView({ ...word, tree: 'nope' }) === null && cleanNodeView({ ...word, lines: [{ text: 'TEST', gesture: '<b>' }] })?.lines[0].gesture === undefined, 'a node off the wire is rebuilt: a speaker or a tree that is not one is no node, and a gesture that is not one is dropped');
  const up = cleanStoryWord({ t: 'story', do: 'talk', op: 'pick', speaker: CLERK, reply: 'job', at: { p: [1, 2] } }, 'up');
  ok(up?.do === 'talk' && up.op === 'pick' && up.reply === 'job' && cleanStoryWord({ t: 'story', do: 'talk', op: 'pick', speaker: CLERK, reply: 'a.b' }, 'up') === null && cleanStoryWord({ t: 'story', do: 'talk', op: 'sing', speaker: CLERK }, 'up') === null, 'a browser\'s word to talk is cleaned: an answer is named by its own id, and an operation is one of three');
}

// ---- the browser's host and the server's: the same nodes, the same book -------------------------------------------
{
  const local = hostOf();
  const purses = new Purses();
  const centre = { x: -1376, z: -3576 };
  const worlds = { worldOf: (p: string) => p, kindOf: () => 'planet', centreOf: () => centre, hourOf: () => null, describe: () => ({}) };
  const server = new Stories({ tuning: { ...STORY_TUNING, talkRate: 1000 }, write: (rec: object) => void applyStory(server.data, rec), now: () => clock, purses, worlds, read: () => ({ test: FILES, own: null }), admin: () => true, tests: true });
  server.readSets();
  // The player stands where the clerk is put, in the game's frame (raw X mirrored about the centre).
  const near = { p: [-(3482 - centre.x), 0, -4690 - centre.z] };
  const c = { id: 1, character: 'char-1', keep: 'server', asking: null, hello: { planet: 'tatooine', zone: '' }, state: near };
  server.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  const nodes: NodeView[] = [];
  const say = (op: string, reply: string | null = null) => {
    const r = server.hear(c, { t: 'story', do: 'talk', op, speaker: CLERK, ...(reply ? { reply } : {}), at: { p: [3482, -4690] } }) as { tell: { msg: Record<string, unknown> }[] };
    const w = r.tell.map((t) => cleanStoryWord(t.msg, 'down')).find((w) => w?.do === 'node');
    if (w?.do === 'node' && w.view) nodes.push(w.view);
    return w?.do === 'node' ? w : null;
  };
  credits = purses.of('char-1');
  const script: [string, string | null][] = [['open', null], ['pick', 'job'], ['open', null], ['pick', 'done'], ['open', null], ['pick', null], ['pick', 'press'], ['open', null], ['pick', null], ['pick', 'name']];
  const localNodes: NodeView[] = [];
  let state = null as ReturnType<HostCore['talkOpen']>['turn']['state'];
  for (const [op, reply] of script) {
    const out = op === 'open' ? local.talkOpen(CLERK, ctx()) : local.talkPick(state!, reply, ctx());
    state = out.turn.state;
    if (out.turn.view) localNodes.push(out.turn.view);
    say(op, reply);
  }
  const sb = server.bookOf('char-1') as StoryBook;
  for (const k of ['heard', 'npcs', 'quests', 'tracks'] as const) if (!same(sb[k], local.book[k])) note(`differs in ${k}: ${stableText(sb[k]).slice(0, 300)} | ${stableText(local.book[k]).slice(0, 300)}`);
  ok(localNodes.length === script.length && nodes.length === script.length && same(nodes, localNodes), `the server gives the very node views the browser's own host does (${nodes.map((n) => n.node).join(', ')})`);
  ok(same(sb.heard, local.book.heard) && same(sb.npcs, local.book.npcs) && same(sb.quests?.['test:talk'], local.book.quests?.['test:talk']) && sb.tracks?.freelance?.trust === local.book.tracks?.freelance?.trust, 'and leaves the same book: heard, met and named, the job done, Trust moved once');
  ok(server.stats.paidCredits === 5, 'the talk job\'s reward paid once, by the server');
  // A price charged on the server goes through the purse's own spend.
  const before = purses.of('char-1');
  say('open');
  say('pick', null);
  say('pick', 'pay');
  ok(purses.of('char-1') === before - 10 && server.stats.charged === 10, 'a price is taken out of the server\'s purse');
  // What the server will not take on a browser's word.
  c.state = { p: [-(3600 - centre.x), 0, -4690 - centre.z] };
  const far = say('open');
  ok(far?.view === null && /too far/.test(far.why ?? ''), `a cast member is not spoken to from out of reach (${far?.why})`);
  c.state = near;
  const wrongWorld = { ...c, id: 2, character: 'char-2', hello: { planet: 'naboo', zone: '' } };
  server.hear(wrongWorld, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  const r2 = server.hear(wrongWorld, { t: 'story', do: 'talk', op: 'open', speaker: CLERK, at: {} }) as { tell: { msg: Record<string, unknown> }[] };
  ok(/not on the world/.test(String(r2.tell[0]?.msg.why)), 'nor from another world');
  // A conversation with the clerk open, within reach: an answer to somebody else is refused, and leaves it open.
  const held = () => (server.lines.get(1) as { talk: { speaker: string; node: string } | null }).talk;
  say('open');
  ok(held()?.speaker === CLERK, 'opened within reach, the line holds a conversation with the clerk');
  const stranger = server.hear(c, { t: 'story', do: 'talk', op: 'pick', speaker: DOOMED, reply: 'a', at: {} }) as { tell: { msg: Record<string, unknown> }[] };
  ok(/not talking to them/.test(String(stranger.tell[0]?.msg.why)) && held()?.speaker === CLERK, 'an answer to somebody the line is not talking to is refused, and the conversation it is having stands');
  // Walked off mid-conversation: every answer is measured again.
  c.state = { p: [-(3600 - centre.x), 0, -4690 - centre.z] };
  const walked = say('pick', 'name');
  ok(walked?.view === null && /too far/.test(walked.why ?? '') && held() === null, `an answer from out of reach is refused, and the conversation let go (${walked?.why})`);
  c.state = near;
  say('open');
  ok(held() !== null, 'back within reach it opens again');
  server.hear(c, { t: 'story', do: 'talk', op: 'close', speaker: CLERK, at: {} });
  ok(held() === null, 'closing lets the conversation go: the line holds none, and the next opens at the entry');
  const slow = new Stories({ tuning: { ...STORY_TUNING, talkRate: 2 }, write: (rec: object) => void applyStory(slow.data, rec), now: () => clock, read: () => ({ test: FILES, own: null }), tests: true });
  slow.readSets();
  slow.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  // Closes first: never counted, so the two openings after them still go through.
  for (let i = 0; i < 4; i++) slow.hear(c, { t: 'story', do: 'talk', op: 'close', speaker: CLERK, at: {} });
  const heard = [0, 1, 2, 3].map(() => slow.hear(c, { t: 'story', do: 'talk', op: 'open', speaker: CLERK, at: {} }) as { why?: string; tell: { msg: Record<string, unknown> }[] });
  const answers = heard.map((r) => r.why);
  ok(answers.filter((w) => w === 'too often').length === 2 && answers[0] !== 'too often' && answers[1] !== 'too often', `no more openings and answers a second than the allowance, and a close is never counted (${answers.join(', ')})`);
  const over = cleanStoryWord(heard[3].tell[0]?.msg, 'down');
  ok(over?.do === 'node' && over.view === null && over.why === TALK_TOO_OFTEN, 'and one over it is answered at once with no node and why, so the window need not wait out its own clock');
}

// ---- a cast member stood only while their condition holds, on the browser's view and on the server alike -------------
{
  const head = { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' };
  const castFile = (id: string, tree: string, stand?: string) => ({ path: `cast/${id}.jsonc`, text: JSON.stringify({ id, name: `TEST ${id}`, body: 'x', world: 'tatooine', at: [0, 0], tree, ...(stand ? { stand } : {}) }) });
  const treeFile = (id: string, nodes: Record<string, unknown>) => ({ path: `talk/${id}.jsonc`, text: JSON.stringify({ format: 1, id, entry: [{ to: 'a' }], nodes }) });
  const files = [head, castFile('porter', 'talk/p'), castFile('ghost', 'talk/g', 'flag(own.here)'), treeFile('p', { a: { say: ['TEST: I let them in.'], do: ['flag(own.here, 1)'], end: true } }), treeFile('g', { a: { say: ['TEST: Here at last.'], end: true } })];
  const own = loadSet(files);
  ok(own.errors.length === 0, `a set with a cast member who stands only on a condition reads (${own.errors.map((e) => e.message).join('; ')})`);
  const at = { now: clock, char: 'char-g', payer: 'browser' as const };
  const book = emptyBook('char-g');
  ok(same(viewOf(book, own.set, at).cast.map((x) => x.id), ['own:cast/porter']), 'the view leaves out one whose condition does not hold');
  const centre = { x: -1376, z: -3576 };
  const worlds = { worldOf: (p: string) => p, kindOf: () => 'planet', centreOf: () => centre, hourOf: () => null, describe: () => ({}) };
  const server = new Stories({ tuning: { ...STORY_TUNING, talkRate: 1000 }, write: (rec: object) => void applyStory(server.data, rec), now: () => clock, purses: new Purses(), worlds, read: () => ({ test: null, own: files }), admin: () => true });
  server.readSets();
  const c = { id: 7, character: 'char-g', keep: 'server', asking: null, hello: { planet: 'tatooine', zone: '' }, state: { p: [centre.x, 0, -centre.z] } };
  server.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  const word = (speaker: string) => cleanStoryWord((server.hear(c, { t: 'story', do: 'talk', op: 'open', speaker, at: {} }) as { tell: { msg: Record<string, unknown> }[] }).tell.find((t) => t.msg.do === 'node')?.msg, 'down');
  const before = word('own:cast/ghost');
  ok(before?.do === 'node' && before.view === null && before.why === 'they are not here just now', `the server will not open a conversation with one whose condition does not hold (${before?.do === 'node' ? before.why : 'no node'})`);
  const porter = word('own:cast/porter');
  ok(porter?.do === 'node' && porter.view?.node === 'a' && (server.bookOf('char-g') as StoryBook).flags?.['own.here'] === 1, 'another conversation sets the flag');
  const after = word('own:cast/ghost');
  ok(after?.do === 'node' && after.view?.node === 'a', 'and then it opens');
  ok(viewOf(server.bookOf('char-g') as StoryBook, own.set, at).cast.length === 2, 'and the view stands them too');
}

// ---- the cast stood in the world ---------------------------------------------------------------------------------
{
  const stands = new StoryStands();
  const view = viewOf(emptyBook('x'), lib, { now: clock, char: 'x', payer: 'browser' });
  const stood: { id: string; x: number; z: number; heading: number; name: string; body: CastBody & { removed: boolean } }[] = [];
  const downs: CastBody[] = [];
  const deps = {
    stand: (c: { id: string }, x: number, z: number, _y: number | null, heading: number, name: string) => {
      const body = { removed: false, label: name, rename(n: string) { this.label = n; } };
      stood.push({ id: c.id, x, z, heading, name, body });
      return body;
    },
    unstand: (b: CastBody) => void downs.push(b),
    roomFloor: () => null,
    text: (t: unknown) => (typeof t === 'string' ? t : (t as { en: string }).en),
  };
  const centre = { x: -1376, z: -3576 };
  const gx = -(3482 - centre.x);
  const gz = -4690 - centre.z;
  stands.stepCast(view.cast, 'tatooine', 1, centre, gx + STAND_TUNE.castNear + 50, gz, 0, deps);
  ok(stood.length === 0, `nobody is stood while the player is more than ${STAND_TUNE.castNear} m away`);
  stands.stepCast(view.cast, 'tatooine', 1, centre, gx + 10, gz, 0, deps);
  const clerk = stood.find((s) => s.id === CLERK);
  ok(stood.length === 3 && !!clerk && Math.abs(clerk.x - gx) < 1e-9 && Math.abs(clerk.z - gz) < 1e-9 && clerk.name === 'TEST: a clerk' && Math.abs(clerk.heading - (-90 * Math.PI) / 180) < 1e-9, 'near, the cast is stood at its places turned into the world\'s frame, by the name the player knows them by, facing its heading mirrored');
  stands.stepCast(view.cast, 'tatooine', 1, centre, gx + 10, gz, 100, deps);
  ok(stood.length === 3 && stands.castOf(clerk!.body) === CLERK && stands.castOf({}) === null, 'nobody is stood twice, and a body is known for the cast member it was stood for');
  const named = view.cast.map((c) => (c.id === CLERK ? { ...c, name: 'TEST CLERK', named: true } : c));
  stands.stepCast(named, 'tatooine', 1, centre, gx + 10, gz, 200, deps);
  ok(clerk!.body.label === 'TEST CLERK', 'a name given is the name they go by where they stand');
  const between = (STAND_TUNE.castNear + STAND_TUNE.castFar) / 2;
  stands.stepCast(named, 'tatooine', 1, centre, gx + between, gz, 250, deps);
  ok(STAND_TUNE.castFar > STAND_TUNE.castNear && downs.length === 0 && stood.length === 3 && stands.castOf(clerk!.body) === CLERK, `between ${STAND_TUNE.castNear} m and ${STAND_TUNE.castFar} m (${between} m) nobody is taken down, so walking the edge does not stand and drop them`);
  stands.stepCast(named, 'tatooine', 1, centre, gx + STAND_TUNE.castFar + 50, gz, 300, deps);
  ok(downs.length === 3 && stands.castOf(clerk!.body) === null, `past ${STAND_TUNE.castFar} m the cast is taken down`);
  stands.stepCast(named.filter((c) => c.id !== DOOMED), 'tatooine', 1, centre, gx, gz, 400, deps);
  stands.stepCast([], 'tatooine', 1, centre, gx, gz, 500, deps);
  ok(downs.length === 5, 'and so is one the story no longer stands');
  stands.stepCast(named, 'naboo', 2, centre, gx, gz, 600, deps);
  ok(stood.length === 5, 'and on another world nobody of Tatooine\'s is stood');
  const inRoom = [{ ...named[0], room: { cell: 'cantina' } }];
  const before = stood.length;
  stands.stepCast(inRoom, 'tatooine', 3, centre, gx, gz, 700, deps);
  ok(stood.length === before, 'one in a room waits until a building with that room has streamed in');
}

// ---- a live relay ----------------------------------------------------------------------------------------------------
if (typeof WebSocket === 'undefined') {
  note('the relay round trip was skipped: this node has no WebSocket of its own');
} else {
  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'swg-talk-relay-'));
  const port = 18823;
  process.env.PORT = String(port);
  process.argv.push(`--data=${join(dir, 'world')}`, '--story-tests', `--story=${join(dir, 'none')}`, '--set=story.evRate=40');
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const key = new Uint8Array(randomBytes(32));
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: Record<string, unknown>[] = [];
  let nonce = '';
  try {
    await new Promise<void>((done, fail) => {
      ws.addEventListener('open', () => done());
      ws.addEventListener('error', () => fail(new Error('could not connect')));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as Record<string, unknown>;
      if (m.t === 'hail') nonce = String(m.nonce ?? '');
      got.push(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    await wait(150);
    const hail = got.find((m) => m.t === 'hail') as { story?: { v: number } } | undefined;
    ok(hail?.story?.v === 3, 'the relay\'s hail says it plays conversations');
    send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character: 'c-talk', name: 'Han', counter: 1, about: { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' } });
    await wait(150);
    send({ t: 'hello', name: 'Han', species: 'human_male', class: 'jedi', planet: 'tatooine', v: 5 });
    await wait(150);
    send({ t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
    await wait(250);
    const view = [...got].reverse().find((m) => m.t === 'story' && m.do === 'view') as { view?: { cast: { id: string }[] } } | undefined;
    ok(!!view?.view?.cast.some((c) => c.id === CLERK), 'a settled line is sent the cast to stand in its view');
    send({ t: 'story', do: 'talk', op: 'open', speaker: CLERK, at: { p: [3483, -4690] } });
    await wait(200);
    const opened = cleanStoryWord([...got].reverse().find((m) => m.t === 'story' && m.do === 'node'), 'down');
    ok(opened?.do === 'node' && opened.view?.node === 'hello' && opened.view.replies.length === 6, `the relay answers an opening with the node it reached (${opened?.do === 'node' ? opened.view?.node : 'none'})`);
    send({ t: 'story', do: 'talk', op: 'pick', speaker: CLERK, reply: 'job', at: {} });
    await wait(200);
    const given = cleanStoryWord([...got].reverse().find((m) => m.t === 'story' && m.do === 'node'), 'down');
    const ch = got.filter((m) => m.t === 'story' && m.do === 'ch').flatMap((m) => m.ch as { k: string; quest?: string }[]);
    ok(given?.do === 'node' && given.view?.node === 'given' && ch.some((c) => c.k === 'qState' && c.quest === 'test:talk'), 'and an answer with the next node, the job it granted written down and sent as a batch');
    send({ t: 'story', do: 'talk', op: 'close', speaker: CLERK, at: {} });
    await wait(100);
    // One of the game's own people: a herald, by her row and the creature she is stood as, out of the Core3
    // reference the relay folds beside the sets it reads.
    const herald = 'row:h98e10cfdf08';
    send({ t: 'story', do: 'talk', op: 'open', speaker: herald, who: 'herald_corellia_karin', at: {} });
    await wait(200);
    const spoke = cleanStoryWord([...got].reverse().find((m) => m.t === 'story' && m.do === 'node'), 'down');
    ok(spoke?.do === 'node' && spoke.speaker === herald && spoke.view?.tree === 'core3:talk/heraldCorellia2ConvoTemplate' && spoke.view.node === 'init' && /^@conversation\/heraldcorellia2:/.test(String(spoke.view.lines[0]?.text)), `the relay plays a herald's conversation in the client's own words (${spoke?.do === 'node' ? spoke.view?.node : 'none'})`);
    send({ t: 'story', do: 'talk', op: 'close', speaker: herald, at: {} });
    await wait(100);
    const status = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { stories: { talks: number; cast: number; v: number; stats: { talks: number }; core3: { played: number; trees: number; voiced: number } } };
    ok(status.stories.v === 3 && status.stories.talks === 2 && status.stories.cast === 3 && status.stories.stats.talks === 3, 'the status page counts the conversations, the cast and the turns played');
    ok(status.stories.core3?.played === 7 && status.stories.core3.trees === 289 && status.stories.core3.voiced === 7, "and the game's own: the seven heralds of the reference's 289 trees");
  } finally {
    ws.close();
    await wait(100);
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${checks} checks passed`);
process.exit(0);
