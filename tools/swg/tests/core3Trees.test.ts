// The emulator's conversations made into conversations this game plays (src/story/core3Trees.ts): the fold of
// the Core3 reference's structure into the tree player's own shape, the `needs` it marks, the adoptions of ours
// laid over it, the heralds' waypoints, which trees anybody is given, and the two hosts playing one alike.
//
// What is pinned:
//
//   - a screen is a node, its line the client's string id with the gesture it names, its answers numbered from
//     nought, its first screen the one entry with no condition, and the fold is the same every time (its hash)
//     and another the moment one line changes;
//   - a node is marked `needs` wherever the structure has not got what the handler did -- a line it writes, the
//     emulator's own English, a dead end it adds answers to, a link to no screen, a screen it names, a first
//     screen it picks, and every node of a tree whose handler writes words or answers without naming where or
//     was never read -- and a tree any such node can be reached in is not played; an adoption's own actions
//     clear what the handler did where it writes them, and an adopted answer carries its condition, how it is
//     shown when refused and its actions;
//   - only an adopted tree is anybody's: one the structure alone could play is kept and given to nobody;
//   - a herald's location screens put a quest-coloured waypoint on the place the reference's table gives
//     their number, named with the client's string id the other heralds name it with, else with the words of
//     the answer that leads there; reaching one twice sets it once;
//   - the committed adoption reads clean, and over the committed reference the seven heralds it names are
//     played, Tatooine's second (which charges, from code) is not, and nothing else is anybody's;
//   - one of the game's own people (`row:<key>`) is given a conversation by the creature they are stood as,
//     the state remembers it, and a revised tree starts again for them as for anybody;
//   - the browser's own host and the server (folding the same reference) give the same nodes and the same book,
//     and the word up carries the creature only for one of the game's own people;
//   - the server's host on the browser's side asks a server only for somebody the game gives a conversation,
//     whether or not the server reads a story set;
//   - a server that reads no story set still lets the heralds speak and marks their places, and leaves a job of
//     a set it does not read exactly as it was, while nobody of a story is spoken to there;
//   - a herald waypoint cut to length by a host from before is not set twice;
//   - the console's review plays any tree that can be read through, on a book nothing keeps.
//
// Synthetic trees but for the committed reference and adoption, which are read as the relay reads them. Nothing
// is read from the game's own files.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readCore3Story } from '../../../server/core3Story.mjs';
import { readStorySet } from '../../../server/storySet.mjs';
import { STORY_TUNING, Stories, applyStory } from '../../../server/stories.mjs';
import { emptyBook } from '../../../src/story/book.ts';
import { CORE3_TUNE, captureOf, core3Set, foldTree, heraldKey, plainOf, readOverlays, reachable, tablesOf, voicesOf, type Core3Capture } from '../../../src/story/core3Trees.ts';
import { HostCore, type HostCtx } from '../../../src/story/hostCore.ts';
import { LocalHost } from '../../../src/story/localHost.ts';
import { RemoteHost } from '../../../src/story/remoteHost.ts';
import { joinSets, loadSet, stableText } from '../../../src/story/set.ts';
import { cleanStoryWord } from '../../../src/story/storyWire.ts';
import { treeFor, type NodeView } from '../../../src/story/talkRules.ts';
import { WAYPOINT_TUNE } from '../../../src/story/waypoints.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const same = (a: unknown, b: unknown): boolean => stableText(a) === stableText(b);

// ---- a capture of our own: every shape the fold has to tell apart -------------------------------------------------
const T = (id: string, say: string | null, replies: [string | null, string | null][] = [], extra: Record<string, unknown> = {}) => ({ id, say, end: replies.length === 0 && extra.end !== false, replies: replies.map(([text, to]) => ({ text, to })), ...extra });
const noLogic = { entry: false, options: false, text: false, screens: [], entries: [] };
const capture: Core3Capture = captureOf({
  trees: {
    // Complete, and no handler: playable, and nobody's until adopted.
    plainTree: { file: 'a.lua', initial: 'init', handler: 'conv_handler', nodes: [T('init', '@conversation/plain:s_1', [['@conversation/plain:s_2', 'bye']], { gesture: 'nod_head_once' }), T('bye', '@conversation/plain:s_3')], logic: noLogic },
    // A line the handler writes, and a screen it names.
    handlerTree: { file: 'b.lua', initial: 'init', handler: 'someHandler', nodes: [T('init', '@conversation/h:s_1', [['@conversation/h:s_2', 'act']]), T('act', '@conversation/h:s_3'), T('blank', null)], logic: { ...noLogic, screens: ['act'] } },
    // The emulator's own English, kept as null and marked.
    literalTree: { file: 'c.lua', initial: 'init', handler: null, nodes: [{ ...T('init', null), needs: 'core3-literal' }], logic: noLogic },
    // A dead end the handler adds answers to, and a link to no screen.
    deadTree: { file: 'd.lua', initial: 'init', handler: null, nodes: [T('init', '@conversation/d:s_1', [['@conversation/d:s_2', 'gone']]), { ...T('stuck', '@conversation/d:s_3'), end: false }], logic: noLogic },
    // A handler that picks the first screen.
    entryTree: { file: 'e.lua', initial: 'init', handler: 'pick', nodes: [T('init', '@conversation/e:s_1')], logic: { ...noLogic, entry: true, entries: ['init'] } },
    // A herald: three places, the first said two ways.
    heraldTree: {
      file: 'f.lua',
      initial: 'init',
      handler: 'multi_dest_herald_conv_handler',
      nodes: [
        T('init', '@conversation/herald:s_1', [['@conversation/herald:s_10', 'loc1'], ['@conversation/herald:s_11', 'loc1a'], ['@conversation/herald:s_12', 'loc2'], ['@conversation/herald:s_13', 'bye']]),
        T('loc1', '@conversation/herald:s_2'),
        T('loc1a', '@conversation/herald:s_3'),
        T('loc2', '@conversation/herald:s_4'),
        T('bye', '@conversation/herald:s_5'),
      ],
      logic: { ...noLogic, screens: ['loc1', 'loc1a', 'loc2'] },
    },
  },
  shapes: {},
  instances: {},
  heralds: {
    multi: [{ who: 'herald_test', world: 'tatooine', x: 100, y: 5, z: 200, heading: 0.5, cell: 0, table: 'conversation/herald', dests: [{ x: 1000, z: -500 }, { x: -3000, z: 4000 }] }],
    // A place another herald names, 40 m from the first, and one on another world at the second's spot.
    directions: [{ world: 'tatooine', x: 1040, z: -500, name: '@spawning/static_npc/herald_place:waypoint_name_1' }, { world: 'naboo', x: -3000, z: 4000, name: '@spawning/static_npc/elsewhere:waypoint_name_1' }],
  },
});
const voices = voicesOf({ herald_test: { tree: 'heraldTree' }, plain_person: { tree: 'plainTree', diction: 'military', faction: 'rebel' }, handler_person: { tree: 'handlerTree' } });
const overlayFile = { path: 'test.jsonc', text: JSON.stringify({ format: 1, credit: 'SWGEmu Core3 test credit', trees: { heraldTree: { waypoints: 'heralds' }, handlerTree: { nodes: { blank: { do: ['say(TEST)'] } } } } }) };

// ---- the fold ---------------------------------------------------------------------------------------------------
{
  const plain = foldTree('plainTree', capture.trees.plainTree);
  const d = plain.def;
  ok(d.id === 'core3:talk/plainTree' && d.source === 'core3' && /Core3/.test(d.credit ?? '') && d.entry.length === 1 && d.entry[0].to === 'init' && d.entry[0].when === null, 'a tree is a conversation of its own id, credited, starting at its first screen with no condition');
  ok(d.nodes.init.say[0].text === '@conversation/plain:s_1' && d.nodes.init.say[0].gesture === 'nod_head_once' && d.nodes.init.replies[0].id === '0' && d.nodes.init.replies[0].to === 'bye' && d.nodes.bye.end, "a screen's line is the client's string id with the gesture it names, its answers are numbered from nought, and a stop is an end");
  ok(plain.playable && plain.complete && plain.needs.length === 0 && /^[0-9a-f]{16}$/.test(d.hash) && foldTree('plainTree', capture.trees.plainTree).def.hash === d.hash, 'a tree with nothing of the handler in reach is playable, and folds to the same hash every time');
  const h = foldTree('handlerTree', capture.trees.handlerTree);
  ok(!h.playable && h.def.nodes.act.needs === 'logic' && h.def.nodes.blank.needs === 'logic' && same(h.needs, ['act']), 'a screen the handler names, and one whose line it writes, are marked; the one reachable keeps the tree from being played');
  const lit = foldTree('literalTree', capture.trees.literalTree);
  ok(!lit.playable && !lit.complete && lit.def.nodes.init.needs === 'core3-literal' && lit.def.nodes.init.say.length === 0, "the emulator's own English is never a line: kept as null, marked core3-literal, and not even readable in review");
  const dead = foldTree('deadTree', capture.trees.deadTree);
  ok(!dead.playable && dead.def.nodes.init.needs === 'logic' && dead.def.nodes.init.replies[0].to === null && dead.def.nodes.stuck.needs === 'logic', 'an answer linking to no screen is not followed, and a screen that neither ends nor answers is the handler\'s');
  const e = foldTree('entryTree', capture.trees.entryTree);
  ok(!e.playable && e.def.nodes.init.needs === 'logic', 'a handler that picks the first screen makes the structure\'s first a guess, and marks it');
  ok(same(tablesOf(d), ['conversation/plain']) && reachable(d).size === 2, 'what a conversation can reach, and the tables its words are in');
  // The hash is the tree's: one line changed is another conversation, which is what restarts one mid-way.
  const changed = { ...capture.trees.plainTree, nodes: capture.trees.plainTree.nodes.map((n) => (n.id === 'bye' ? { ...n, say: '@conversation/plain:s_4' } : n)) };
  ok(foldTree('plainTree', changed).def.hash !== d.hash, 'a tree with one line changed folds to another hash');
}

// ---- a handler that acts nowhere in particular, and what an adoption clears ---------------------------------------
{
  const more = captureOf({
    trees: {
      // Words written by the handler, with no screen named: nowhere is safe.
      textTree: { file: 'g.lua', initial: 'init', handler: 'words', nodes: [T('init', '@conversation/g:s_1', [['@conversation/g:s_2', 'bye']]), T('bye', '@conversation/g:s_3')], logic: { ...noLogic, text: true } },
      // Answers added by the handler, with no screen named.
      optionTree: { file: 'h.lua', initial: 'init', handler: 'answers', nodes: [T('init', '@conversation/h2:s_1', [['@conversation/h2:s_2', 'bye']]), T('bye', '@conversation/h2:s_3')], logic: { ...noLogic, options: true } },
      // A handler the reader could not find at all.
      unreadTree: { file: 'i.lua', initial: 'init', handler: 'lost', nodes: [T('init', '@conversation/i:s_1', [['@conversation/i:s_2', 'bye']]), T('bye', '@conversation/i:s_3')], logic: { ...noLogic, unread: true } },
      // A screen the handler names, reachable: what an adoption has to write for the tree to play.
      adoptTree: { file: 'j.lua', initial: 'init', handler: 'acts', nodes: [T('init', '@conversation/j:s_1', [['@conversation/j:s_2', 'act'], ['@conversation/j:s_4', 'bye']]), T('act', '@conversation/j:s_3'), T('bye', '@conversation/j:s_5')], logic: { ...noLogic, screens: ['act'] } },
    },
    shapes: {},
    instances: {},
    heralds: { multi: [], directions: [] },
  });
  for (const name of ['textTree', 'optionTree', 'unreadTree']) {
    const f = foldTree(name, more.trees[name]);
    ok(!f.playable && same(f.needs, ['bye', 'init']) && f.def.nodes.init.needs === 'logic' && f.def.nodes.bye.needs === 'logic', `${name}: a handler that writes words or answers without naming where, or one never read, marks every node`);
  }
  const bare = foldTree('adoptTree', more.trees.adoptTree);
  ok(!bare.playable && same(bare.needs, ['act']), 'unadopted, a reachable screen the handler names keeps the tree from being played');
  const ov = readOverlays([{ path: 'adopt.jsonc', text: JSON.stringify({ format: 1, credit: 'SWGEmu Core3 test credit', trees: { adoptTree: { nodes: { act: { do: ['say(TEST)'] } }, replies: { 'init.0': { when: 'credits() >= 10', show: 'disable', do: ['say(TEST)'] } } } } }) }]);
  ok(ov.errors.length === 0, `an adoption of a node and of an answer reads clean (${ov.errors.map((i) => i.message).join('; ')})`);
  const adopted = foldTree('adoptTree', more.trees.adoptTree, { overlay: ov.overlays[0].trees.adoptTree });
  ok(adopted.playable && adopted.needs.length === 0 && adopted.def.nodes.act.needs === null && adopted.def.nodes.act.do.length === 1 && adopted.def.nodes.act.do[0].act === 'say', "an adoption's actions on a screen clear what the handler did there, and the tree is played");
  const r0 = adopted.def.nodes.init.replies[0];
  const r1 = adopted.def.nodes.init.replies[1];
  ok(r0.when !== null && r0.show === 'disable' && r0.do.length === 1 && r0.do[0].act === 'say' && r1.when === null && r1.show === 'hide' && r1.do.length === 0, "an adopted answer carries its condition, how it is shown when refused and its actions; the others carry nothing");
  ok(adopted.def.hash !== bare.def.hash, 'and an adopted tree is another conversation than the bare one');
}

// ---- adoptions and the heralds ------------------------------------------------------------------------------------
{
  const read = readOverlays([overlayFile]);
  ok(read.errors.length === 0 && read.overlays[0].trees.heraldTree.waypoints === 'heralds' && read.overlays[0].trees.handlerTree.nodes.blank.do[0].act === 'say', `an adoption reads its trees and its actions in our own vocabulary (${read.errors.map((i) => i.message).join('; ')})`);
  const bad = readOverlays([{ path: 'bad.jsonc', text: JSON.stringify({ format: 1, credit: 'none', trees: { x: { waypoints: 'everywhere', nodes: { a: { do: ['nonsense()'] } }, replies: { nodot: { do: [] } } } } }) }]);
  ok(bad.errors.length >= 4 && bad.errors.some((i) => /replies\/nodot/.test(i.message) || /<screen>\.<its number/.test(i.message)), `one with no credit, a source of waypoints that is not the heralds', an action that is not one and an answer not named <screen>.<n> is refused (${bad.errors.length} problems)`);
  const built = core3Set(capture, voices, read.overlays);
  ok(same(built.report.played, ['heraldTree']) && same(built.report.playable.sort(), ['heraldTree', 'plainTree']) && built.report.voiced === 1, 'only an adopted tree is played: one the structure alone could play is kept and given to nobody');
  ok(built.set.voices!.herald_test === 'core3:talk/heraldTree' && !('plain_person' in built.set.voices!) && !('handler_person' in built.set.voices!), 'and only an adopted, playable tree binds the creature that speaks it');
  ok(built.report.unplayable.handlerTree?.length === 1 && built.report.unplayable.handlerTree[0] === 'act', 'an adoption that does not cover everything the handler did is reported, with what it left');
  ok(built.set.sets.length === 0 && built.set.prefix === 'core3' && joinSets([built.set]).sets.length === 0, 'the conversations list no set of their own, so joining them makes nobody "read a story"');
  const fold = built.folds.heraldTree;
  ok(fold.playable && same(Object.keys(fold.waypoints).sort(), ['loc1', 'loc1a', 'loc2']), 'a herald\'s every location screen is covered, and the tree played');
  ok(fold.waypoints.loc1.name === '@spawning/static_npc/herald_place:waypoint_name_1' && fold.waypoints.loc1.x === 1000 && fold.waypoints.loc1a.x === 1000 && 40 <= CORE3_TUNE.nameNear, 'a place another herald names within reach takes that name, the client\'s own, and loc1a is the first place said another way');
  ok(fold.waypoints.loc2.name === '@conversation/herald:s_12' && fold.waypoints.loc2.world === 'tatooine', 'a place nobody else names on its own world takes the words of the answer that leads to it');
  // Played: the waypoint put down, quest-coloured, once however often the screen is reached.
  const h = new HostCore({ book: emptyBook('char-h'), lib: built.set, payer: 'browser' });
  const ctx: HostCtx = { now: 1_800_000_000_000, world: 'tatooine', here: [100, 200], room: null, credits: 0 };
  const speaker = `row:${heraldKey(capture.heralds.multi[0])}`;
  const a = h.talkOpen(speaker, ctx, 'herald_test');
  ok(a.turn.view?.node === 'init' && a.turn.state?.who === 'herald_test' && a.turn.view.replies.length === 4 && h.book.npcs?.[speaker]?.met !== undefined, 'one of the game\'s own people speaks the conversation their creature is given, the person met, the creature kept with where it stands');
  const b = h.talkPick(a.turn.state!, '0', ctx);
  const wps = h.book.waypoints.filter((w) => w.by);
  ok(b.turn.view?.node === 'loc1' && b.turn.view.end && wps.length === 1 && wps[0].name === '@spawning/static_npc/herald_place:waypoint_name_1' && wps[0].colour === WAYPOINT_TUNE.defaultQuest && wps[0].world === 'tatooine' && wps[0].p[0] === 1000 && wps[0].p[1] === -500, 'a location screen reached puts a quest-coloured waypoint on its place, named whole in the client\'s words');
  const again = h.talkOpen(speaker, ctx, 'herald_test');
  h.talkPick(again.turn.state!, '1', ctx);
  ok(h.book.waypoints.filter((w) => w.by).length === 1, 'and the first place said the other way is the same waypoint, set once');
  // A book whose herald waypoint a host from before cut to length: talking again sets no second one.
  const cutBook = emptyBook('char-cut');
  const placeName = '@spawning/static_npc/herald_place:waypoint_name_1';
  cutBook.waypoints.push({ id: 'w1', name: placeName.slice(0, WAYPOINT_TUNE.nameMax), world: 'tatooine', f: 'raw', p: [1000, -500, null], colour: WAYPOINT_TUNE.defaultQuest, on: true, made: 0, by: 'run' });
  cutBook.nextWp = 2;
  const cut = new HostCore({ book: cutBook, lib: built.set, payer: 'browser' });
  cut.talkPick(cut.talkOpen(speaker, ctx, 'herald_test').turn.state!, '0', ctx);
  ok(placeName.length > WAYPOINT_TUNE.nameMax && cutBook.waypoints.length === 1, 'a herald waypoint a host from before cut to length is still the one the herald sets, and is not set twice');
  ok(h.talkOpen(speaker, ctx, null).turn.view === null && h.talkOpen('row:other', ctx, 'plain_person').turn.view === null && treeFor(built.set, speaker, 'herald_test')?.id === 'core3:talk/heraldTree' && treeFor(built.set, 'test:cast/x', 'herald_test') === null, 'without the creature, or with one given nothing, there is nothing to say; and a creature never names a cast member\'s conversation');
  // A revised tree under a conversation starts again for one of the game's own people as for anybody.
  const st = h.talkOpen(speaker, ctx, 'herald_test').turn.state!;
  const restarted = h.talkPick({ ...st, hash: 'stale' }, '0', ctx);
  ok(restarted.turn.restarted === true && restarted.turn.view?.node === 'init' && restarted.turn.state?.who === 'herald_test', 'a tree revised mid-conversation starts again at its entry, still knowing who speaks');
  ok(heraldKey({ world: 'tatooine', who: 'herald_test' }) === heraldKey({ world: 'tatooine', who: 'herald_test' }) && /^h[0-9a-f]{11}$/.test(heraldKey({ world: 'w', who: 'x' })), "a herald's row key is the same every run");
}

// ---- reading the reference: Maps and their tagged form alike -----------------------------------------------------
{
  const m = new Map<string, unknown>([['a', { $map: [['b', 1]] }], ['__proto__', 2]]);
  const p = plainOf({ x: m, s: new Set([1, 2]) }) as Record<string, Record<string, unknown>>;
  ok((p.x.a as Record<string, unknown>).b === 1 && !Object.hasOwn(p.x, '__proto__') && Array.isArray(p.s), "a Map, the reference's tagged Map and a Set all read as plain tables, and no key reaches a prototype");
}

// ---- the committed reference and adoption -----------------------------------------------------------------------
const real = readCore3Story();
{
  ok(!!real && real.errors.length === 0, `the committed adoption reads clean (${real?.errors.map((i: { message: string }) => i.message).join('; ')})`);
  const r = real!.report;
  const heralds = ['heraldCorellia1ConvoTemplate', 'heraldCorellia2ConvoTemplate', 'heraldLok1ConvoTemplate', 'heraldLok2ConvoTemplate', 'heraldNaboo1ConvoTemplate', 'heraldNaboo2ConvoTemplate', 'heraldTatooine1ConvoTemplate'];
  ok(r.trees === 289 && same(r.adopted, heralds) && same(r.played, heralds) && Object.keys(r.unplayable).length === 0, `over the reference's 289 trees the seven heralds adopted are all played (${r.played.length}), and none left unplayable`);
  ok(!r.played.includes('heraldTatooine2ConvoTemplate') && !real!.folds.heraldTatooine2ConvoTemplate.playable, "Tatooine's second herald, whose handler charges and adds answers from code, is neither adopted nor playable");
  ok(r.voiced === 7 && Object.values(real!.set.voices!).every((id) => heralds.some((hh) => id === `core3:talk/${hh}`)), 'seven kinds of people are given a conversation, every one a herald');
  const named = heralds.flatMap((hh) => Object.values(real!.folds[hh].waypoints));
  ok(named.length >= 14 && named.every((w) => /^@[a-z_/0-9]+:[a-z_0-9]+$/.test(w.name)), `every herald's place is named with one of the client's own string ids (${named.length} places)`);
  // Nothing the reference keeps is the emulator's own English.
  const words: string[] = [];
  for (const name of Object.keys(real!.set.talks)) {
    const t = real!.set.talks[name];
    for (const id of Object.keys(t.nodes)) for (const l of t.nodes[id].say) words.push(String(l.text));
    for (const id of Object.keys(t.nodes)) for (const rr of t.nodes[id].replies) words.push(String(rr.text));
  }
  ok(words.length > 3000 && words.every((w) => /^@[A-Za-z0-9_/.-]+:[A-Za-z0-9_.-]+$/.test(w) || /^:[A-Za-z0-9_.-]+$/.test(w)), `every one of the ${words.length} lines and answers folded is a reference to the client's words, never words`);
}

// ---- the two hosts play a herald alike --------------------------------------------------------------------------
{
  const test = readStorySet(fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url))).files;
  const lib = joinSets([loadSet(test, { test: true }).set, real!.set]);
  const local = new HostCore({ book: emptyBook('char-1'), lib, payer: 'browser' });
  let clock = 1_800_000_000_000;
  const ctx = (): HostCtx => ({ now: clock, world: 'corellia', here: [-185, -4460], room: null, credits: 0 });
  const server = new Stories({ tuning: { ...STORY_TUNING, talkRate: 1000 }, write: (rec: object) => void applyStory(server.data, rec), now: () => clock, read: () => ({ test, own: null }), tests: true, core3: () => readCore3Story() });
  server.readSets();
  ok(server.describe().core3?.played === 7 && server.ready, 'the server folds the same reference beside the sets it reads');
  const c = { id: 1, character: 'char-1', keep: 'server', asking: null, hello: { planet: 'corellia', zone: '' }, state: { p: [0, 0, 0] } };
  server.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 });
  const speaker = 'row:h98e10cfdf08';
  const nodes: NodeView[] = [];
  const say = (op: string, reply: string | null = null, who: string | null = null) => {
    const r = server.hear(c, { t: 'story', do: 'talk', op, speaker, ...(reply ? { reply } : {}), ...(who ? { who } : {}), at: {} }) as { tell: { msg: Record<string, unknown> }[] };
    const w = r.tell.map((t) => cleanStoryWord(t.msg, 'down')).find((x) => x?.do === 'node');
    if (w?.do === 'node' && w.view) nodes.push(w.view);
    return w?.do === 'node' ? w : null;
  };
  const tree = real!.set.talks['core3:talk/heraldCorellia2ConvoTemplate'];
  // A path to a place: through the answers that lead there.
  const script: [string, string | null][] = [['open', null], ['pick', '0'], ['pick', '0'], ['pick', '0'], ['pick', '0']];
  const localNodes: NodeView[] = [];
  let state = null as ReturnType<HostCore['talkOpen']>['turn']['state'];
  for (const [op, reply] of script) {
    if (op === 'pick' && !state) break;
    const out = op === 'open' ? local.talkOpen(speaker, ctx(), 'herald_corellia_karin') : local.talkPick(state!, reply, ctx());
    state = out.turn.state;
    if (out.turn.view) localNodes.push(out.turn.view);
    say(op, reply, op === 'open' ? 'herald_corellia_karin' : null);
    clock += 1000;
  }
  ok(localNodes.length >= 4 && same(nodes, localNodes) && localNodes[0].tree === tree.id, `the server gives the very nodes the browser's own host does, for one of the game's own people (${localNodes.map((n) => n.node).join(', ')})`);
  const sb = server.bookOf('char-1');
  ok(local.book.waypoints.some((w) => w.by) && same(sb.waypoints.map((w: { name: string }) => w.name), local.book.waypoints.map((w) => w.name)), 'and leaves the same waypoint on both books');
  const none = say('open');
  ok(none?.view === null && /nothing to say/.test(none.why ?? ''), 'asked without the creature they are stood as, the server has nothing for them to say');
  const up = cleanStoryWord({ t: 'story', do: 'talk', op: 'open', speaker, who: 'herald_corellia_karin', at: {} }, 'up');
  const cast = cleanStoryWord({ t: 'story', do: 'talk', op: 'open', speaker: 'test:cast/test-clerk', who: 'herald_corellia_karin', at: {} }, 'up');
  const badWho = cleanStoryWord({ t: 'story', do: 'talk', op: 'open', speaker, who: '../x', at: {} }, 'up');
  const protoWho = ['__proto__', 'constructor', 'prototype'].map((who) => cleanStoryWord({ t: 'story', do: 'talk', op: 'open', speaker, who, at: {} }, 'up'));
  ok(up?.do === 'talk' && up.who === 'herald_corellia_karin' && cast?.do === 'talk' && cast.who === undefined && badWho?.do === 'talk' && badWho.who === undefined, 'the word up carries the creature only for one of the game\'s own people, and only a plain name');
  ok(protoWho.every((w) => w?.do === 'talk' && w.who === undefined), 'and never one of the three names that mean something to every object');
  // The browser's half of a server's host: asked only for somebody the game gives a conversation.
  const sent: Record<string, unknown>[] = [];
  const remote = new RemoteHost({ send: (m) => sent.push(m), line: () => ({ host: 'server', story: 3 }), char: () => 'char-1', at: () => ({}), now: () => clock, wall: () => clock, note: () => {}, voiced: (who) => who === 'herald_corellia_karin' });
  ok(remote.canTalk(speaker, 'herald_corellia_karin') && !remote.canTalk(speaker, 'stormtrooper') && !remote.canTalk(speaker, null), 'the server is asked only for one of the game\'s own people the game gives a conversation');
  remote.talk('open', speaker, null, 'herald_corellia_karin');
  remote.tick();
  ok(sent.some((m) => m.do === 'talk' && m.who === 'herald_corellia_karin'), 'and the opening goes up with the creature');
  // A server that reads no story set says so in its view; a herald is still asked of it.
  remote.word({ t: 'story', do: 'view', view: { rev: 0, quests: [], waypoints: [], watch: [], cast: [], objects: [], tracked: [], trackWp: null }, off: 0, read: 0 });
  ok(remote.report().setsRead === false && remote.canTalk(speaker, 'herald_corellia_karin') && !remote.canTalk(speaker, 'stormtrooper'), 'with no story set read, a herald is still asked of the server, since the game\'s own conversations need none');
}

// ---- a server that reads no story set: its heralds still speak, and no job is touched -------------------------------
{
  let clock = 1_800_000_000_000;
  const server = new Stories({ tuning: { ...STORY_TUNING, talkRate: 1000 }, write: (rec: object) => void applyStory(server.data, rec), now: () => clock, read: () => ({ test: null, own: null }), core3: () => readCore3Story() });
  server.readSets();
  ok(!server.ready && server.describe().core3?.played === 7, 'a server with no story set reads none, and still folds the game\'s own conversations');
  const c = { id: 7, character: 'char-n', keep: 'server', asking: null, hello: { planet: 'corellia', zone: '' }, state: { p: [0, 0, 0] } };
  // A book with a job of a set this server does not read: it must come out of a conversation untouched.
  const held = emptyBook('char-n');
  held.quests = Object.create(null);
  held.quests!['own:elsewhere'] = { state: 'active', run: 1, at: clock, completions: 0, defRev: 1, defHash: 'abc', steps: Object.create(null), history: [] };
  server.data.stories['char-n'] = held;
  const synced = server.hear(c, { t: 'story', do: 'sync', has: 0, base: 0, local: 0, known: 0 }) as { tell: { msg: Record<string, unknown> }[] };
  ok(synced.tell.some((t) => t.msg.do === 'view' && t.msg.read === 0), 'and tells the line so in its view');
  const speaker = 'row:h98e10cfdf08';
  const say = (op: string, reply: string | null = null, who: string | null = null) => {
    const r = server.hear(c, { t: 'story', do: 'talk', op, speaker, ...(reply ? { reply } : {}), ...(who ? { who } : {}), at: {} }) as { tell: { msg: Record<string, unknown> }[] };
    clock += 1000;
    const w = r.tell.map((t) => cleanStoryWord(t.msg, 'down')).find((x) => x?.do === 'node');
    return { node: w?.do === 'node' ? w : null, tell: r.tell };
  };
  const opened = say('open', null, 'herald_corellia_karin');
  ok(opened.node?.view?.node === 'init' && opened.node.view.tree === 'core3:talk/heraldCorellia2ConvoTemplate', 'a herald speaks their conversation on a server that reads no story set');
  let last = opened;
  for (let i = 0; i < 4 && last.node?.view && !last.node.view.end; i++) last = say('pick', '0');
  const book = server.bookOf('char-n');
  ok(book.waypoints.some((w: { by?: string }) => w.by) && last.tell.some((t) => t.msg.do === 'ch'), "a place they tell of is marked on the server's book and sent down as any change is");
  ok(book.quests['own:elsewhere']?.state === 'active' && book.quests['own:elsewhere'].defHash === 'abc', 'and a job of a set the server does not read is left exactly as it was');
  ok(say('open', null, 'stormtrooper').node?.view === null && say('open').node?.view === null, 'a creature given nothing, or none named, still has nothing to say');
  const cast = server.hear(c, { t: 'story', do: 'talk', op: 'open', speaker: 'test:cast/test-clerk', at: {} }) as { tell: { msg: Record<string, unknown> }[] };
  ok(cast.tell.some((t) => t.msg.do === 'node' && /no story is read/.test(String(t.msg.why))), "and nobody of a story is spoken to where no story is read");
}

// ---- the local host joins them, and the console's review ---------------------------------------------------------
{
  const book = emptyBook('char-r');
  const told: NodeView[] = [];
  const host = new LocalHost({ book: () => book, holds: () => true, apply: () => true, pay: () => true, note: () => {}, ctx: () => ({ world: 'corellia', here: [0, 0], room: null, credits: 0 }), now: () => 1_800_000_000_000, wall: () => 0, inWorld: () => true });
  host.onNode((w) => {
    if (w.view) told.push(w.view);
  });
  host.useCore3(real!.set);
  ok(!host.canTalk('row:h98e10cfdf08', 'herald_corellia_karin'), 'the game\'s conversations wait until the story\'s own sets have been read, so a book is never held to them alone');
  host.setSets({ test: null, own: null });
  ok(host.canTalk('row:h98e10cfdf08', 'herald_corellia_karin') && !host.canTalk('row:h98e10cfdf08', 'herald_tatooine_errik'), 'then a herald may be spoken to, and Tatooine\'s second, unadopted, may not');
  host.review('open', 'row:review', null, 'core3:talk/heraldTatooine2ConvoTemplate');
  ok(told.at(-1)?.tree === 'core3:talk/heraldTatooine2ConvoTemplate' && told.at(-1)?.node === 'init' && book.heard === undefined, 'the console\'s review plays even an unadopted tree, on a book of its own: the character\'s hears nothing');
  host.review('close', 'row:review');
}

console.log(`\ncore3 trees: ${checks} checks passed`);
