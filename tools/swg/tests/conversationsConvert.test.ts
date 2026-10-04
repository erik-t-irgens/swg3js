// The `conversations` command (tools/swg/conversations.mjs): what it works out from the Core3 reference's
// conversations, the packs' people and the fleet's creatures, what it writes, what `status` says of it, and the
// browser's reading of what it wrote (src/world/conversationPack.ts).
//
// What is pinned, on a slice of our own:
//
//   - only the trees, shapes and calls somebody the packs stand speaks are written, with the heralds' table;
//   - who speaks: every creature that stands and has a conversation or a way of speaking, its faction beside a
//     way of speaking, and a creature that stands nowhere left out;
//   - the heralds with a conversation are stood, as rows of the packs' own shape on their own world with a key
//     that is the same every run, unless the pack already stands them, they stand in a room, or they have no
//     body or no world;
//   - the tables: every one the trees' words are in, every one a herald's place is named from, and the reaction
//     tables; a table the archives have not got is said, not written;
//   - `status` asks for the folder while it is missing, of an older shape, from an older reference, older than a
//     world's people, or missing a table it names, and is quiet otherwise;
//   - the browser folds what was written with the adoptions as the server folds the reference.
//
// And, where this machine has converted it, the folder the owner's own install wrote: its shape, the heralds
// stood, every table it names on disk, and the reaction tables whole. Nothing of it is printed beyond counts.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStorySet } from '../../../server/storySet.mjs';
import { CONVERSATIONS_FORMAT, conversationsStatus, isTablePath, packsUnder, planConversations, reactionTablesIn, referenceHash, tableJson, writeConversations } from '../conversations.mjs';
import { readCore3Story } from '../../../server/core3Story.mjs';
import { captureOf, core3Set, heraldKey, readOverlays, voicesOf } from '../../../src/story/core3Trees.ts';
import { ClientStrings, isTablePath as browserTablePath } from '../../../src/story/strings.ts';
import { ConversationPack } from '../../../src/world/conversationPack.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string): void => console.log(`note ${what}`);

const node = (id: string, say: string, replies: [string, string][] = []) => ({ id, say, end: !replies.length, replies: replies.map(([text, to]) => ({ text, to })) });
const logic = { entry: false, options: false, text: false, screens: [] as string[], entries: [] as string[] };
// The reference's answer, Maps and all, as `readConversations` hands it back.
const conversations = {
  trees: new Map<string, unknown>([
    ['heraldTreeA', { file: 'h.lua', initial: 'init', handler: 'multi_dest_herald_conv_handler', nodes: [node('init', '@conversation/hera:s_1', [['@conversation/hera:s_2', 'loc1']]), node('loc1', '@conversation/hera:s_3')], logic: { ...logic, screens: ['loc1'] } }],
    ['guardTree', { file: 'g.lua', initial: 'init', handler: 'x', nodes: [node('init', '@conversation/guard:s_1')], logic }],
    ['unusedTree', { file: 'u.lua', initial: 'init', handler: null, nodes: [node('init', '@conversation/unused:s_1')], logic }],
  ]),
  shapes: new Map<string, unknown>([['trainer', { factory: 'createTrainerConversationTemplate', params: ['templateName'], initial: null, nodes: [node('intro', '@skill_teacher:intro')] }]]),
  instances: new Map<string, unknown>([['trainer_artisan_convotemplate', { shape: 'trainer', handler: 'trainerConvHandler', args: ['trainer_artisan_convotemplate'] }]]),
  heralds: {
    multi: [
      { who: 'herald_a', world: 'tatooine', x: 10, y: 1, z: 20, heading: 0.5, cell: 0, table: 'conversation/hera', dests: [{ x: 500, z: 600 }] },
      { who: 'herald_stood', world: 'tatooine', x: 30, y: 1, z: 40, heading: 0, cell: 0, table: 'conversation/hera', dests: [] },
      { who: 'herald_room', world: 'tatooine', x: 1, y: 1, z: 1, heading: 0, cell: 77, table: 'conversation/hera', dests: [] },
      { who: 'herald_nobody', world: 'tatooine', x: 1, y: 1, z: 1, heading: 0, cell: 0, table: 'conversation/hera', dests: [] },
      { who: 'herald_away', world: 'kessel', x: 1, y: 1, z: 1, heading: 0, cell: 0, table: 'conversation/hera', dests: [] },
      // A herald the reference speaks no conversation for: neither stood nor said.
      { who: 'herald_silent', world: 'tatooine', x: 5, y: 1, z: 5, heading: 0, cell: 0, table: 'conversation/hera', dests: [] },
    ],
    directions: [{ world: 'tatooine', x: 505, z: 600, name: '@spawning/static_npc/herald_x:waypoint_name_1' }],
  },
};
const speakers = new Map<string, unknown>([
  ['herald_a', { tree: 'heraldTreeA' }],
  ['herald_stood', { tree: 'heraldTreeA' }],
  ['herald_room', { tree: 'heraldTreeA' }],
  ['herald_nobody', { tree: 'heraldTreeA' }],
  ['herald_away', { tree: 'heraldTreeA' }],
  ['rebel_guard', { tree: 'guardTree', diction: 'military' }],
  ['street_kid', { diction: 'slang' }],
  ['trainer_artisan', { tree: 'trainer_artisan_convotemplate' }],
  ['nowhere_person', { diction: 'fancy' }],
  ['herald_silent', { diction: 'fancy' }],
  ['imperial_guard', { diction: 'military' }],
]);
// A guard post that stands a rebel or an imperial by who holds the town (`gcw`), beside the plain rows.
const packs = [{ world: 'tatooine', statics: [{ key: 'k1', who: 'rebel_guard' }, { key: 'k2', who: 'herald_stood' }, { key: 'k3', who: '', draw: [['town.stationaryCommoners', 1]] }, { key: 'k4', who: 'trainer_artisan' }, { key: 'k5', who: 'rebel_guard', gcw: [{ who: 'imperial_guard' }] }], pools: { 'town.stationaryCommoners': ['street_kid'] } }];
// Every herald with a body but the one with none, so only the pack's own row keeps the one it stands from being stood twice.
const creatures = { herald_a: { id: 'dressed_herald_a', faction: 'townsperson' }, herald_stood: { id: 'dressed_stood' }, herald_room: { id: 'dressed_room' }, herald_away: { id: 'dressed_away' }, herald_silent: { id: 'dressed_silent' }, rebel_guard: { id: 'g', faction: 'rebel' }, imperial_guard: { id: 'i', faction: 'imperial' }, street_kid: { id: 's', faction: 'thug' } };

const plan = planConversations({ conversations, speakers, packs, creatures, reactionTables: reactionTablesIn(['string/en/npc_reaction/military.stf', 'string/en/npc_reaction/slang.stf', 'string/en/other/x.stf']) });

// ---- the plan -----------------------------------------------------------------------------------------------------
{
  ok(Object.keys(plan.core3.trees).sort().join() === 'guardTree,heraldTreeA' && !('unusedTree' in plan.core3.trees), 'only the trees somebody the packs (or this command) stand speaks are written');
  ok(Object.keys(plan.core3.instances).join() === 'trainer_artisan_convotemplate' && Object.keys(plan.core3.shapes).join() === 'trainer', 'and the factory calls they name, with the shapes those use');
  ok(plan.speakers.who.rebel_guard?.tree === 'guardTree' && plan.speakers.who.rebel_guard.diction === 'military' && plan.speakers.who.rebel_guard.faction === 'rebel', 'a creature that stands speaks its conversation, greets from its reaction table, and keeps its faction beside it');
  ok(plan.speakers.who.street_kid?.diction === 'slang' && plan.speakers.who.street_kid.faction === 'thug' && !('nowhere_person' in plan.speakers.who), 'one drawn from a town\'s list counts as standing; one that stands nowhere is left out');
  ok(plan.speakers.who.imperial_guard?.diction === 'military' && plan.speakers.who.imperial_guard.faction === 'imperial', 'and so does either side of a guard post that stands by who holds the town');
  ok(plan.speakers.who.herald_a?.tree === 'heraldTreeA' && plan.speakers.who.herald_a.faction === undefined, 'a faction is kept only beside a way of speaking');
  const stood = plan.speakers.stand.tatooine ?? [];
  ok(stood.length === 1 && stood[0].who === 'herald_a' && stood[0].id === 'dressed_herald_a' && stood[0].key === heraldKey({ world: 'tatooine', who: 'herald_a' }) && stood[0].still === true && stood[0].peaceful === true && stood[0].cell === 0 && stood[0].heading === 0.5, `a herald with a conversation and a body is stood on its world as a row of the packs' own shape (${stood.map((r: { who: string }) => r.who).join(', ')})`);
  ok(!stood.some((r: { who: string }) => r.who === 'herald_stood') && !plan.notes.some((n: string) => n.startsWith('herald_stood')), 'one the pack already stands, body and all, is not stood twice, and nothing is said of it');
  ok(plan.notes.some((n: string) => n.startsWith('herald_room')) && plan.notes.some((n: string) => n.startsWith('herald_nobody')) && plan.notes.some((n: string) => n.startsWith('herald_away')) && !plan.speakers.stand.kessel, 'one in a room, with no body or on a world with no pack is said and not stood');
  ok(!stood.some((r: { who: string }) => r.who === 'herald_silent') && !plan.notes.some((n: string) => n.startsWith('herald_silent')) && !plan.core3.heralds.multi.some((h: { who: string }) => h.who === 'herald_silent'), 'a herald with no conversation is neither stood, nor said, nor kept');
  ok(plan.tables.join() === 'conversation/guard,conversation/hera,npc_reaction/military,npc_reaction/slang,spawning/static_npc/herald_x' && plan.tables.every(isTablePath), `the tables: the trees' words, the heralds' places' names and the reaction tables (${plan.tables.join(', ')})`);
  const kept = plan.core3.heralds.multi.map((h: { who: string }) => h.who);
  ok(kept.join() === 'herald_a,herald_stood,herald_room,herald_nobody,herald_away' && kept.every((w: string) => plan.speakers.who[w]?.tree === 'heraldTreeA') && plan.core3.heralds.directions.length === 1 && plan.core3.format === CONVERSATIONS_FORMAT, "every herald speaking a tree written is kept with their places, in the reference's order and whoever stands them (a pack's own included), each given its tree; and the directions their names come from");
}

// ---- the paths a table may have --------------------------------------------------------------------------------------
{
  const good = ['conversation/heraldcorellia1', 'npc_reaction/military', 'spawning/static_npc/herald_x', 'a/..b/c', 'a/.x'];
  const bad = ['../secret', 'conversation/../../x', 'a/../b', 'a/./b', 'a/..', 'a//b', 'a/', '/a', '.a', '', 'a\\b', 'a b'];
  ok(good.every(isTablePath) && good.every(browserTablePath), `a table path the client names is taken by the converter and the browser alike (${good.join(', ')})`);
  ok(bad.every((t) => !isTablePath(t) && !browserTablePath(t)), `and one that climbs, stands still, is empty in a part or is not a path is taken by neither (${bad.filter((t) => isTablePath(t) || browserTablePath(t)).join(', ') || 'none'})`);
  const asked: string[] = [];
  const strings = new ClientStrings('/', (url) => {
    asked.push(url);
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  });
  for (const t of ['conversation/../x', 'a/./b', '../x']) strings.want(t);
  ok(asked.length === 0 && strings.look('conversation/../../x', 's_1') === null && asked.length === 0, 'and the browser fetches nothing for one');
}

// ---- writing it, and what status says ----------------------------------------------------------------------------
{
  const out = mkdtempSync(join(tmpdir(), 'convs-'));
  const ref = mkdtempSync(join(tmpdir(), 'convs-ref-'));
  try {
    writeFileSync(join(ref, 'conversations.json'), '{}\n');
    writeFileSync(join(ref, 'conversation-speakers.json'), '{}\n');
    const tables = new Map<string, Map<string, string>>([['conversation/hera', new Map([['s_1', 'Words.']])], ['npc_reaction/military', new Map([['hi_mid_1', 'Move along.'], ['__proto__', 'x']])]]);
    const w = writeConversations(out, plan, (t: string) => tables.get(t) ?? null, referenceHash(ref));
    ok(w.written === 2 && w.missing.length === 3 && w.missing.includes('conversation/guard'), `a table the archives have not got is said and not written (${w.written} written, ${w.missing.length} missing)`);
    const written = JSON.parse(readFileSync(join(out, 'conversations', 'strings', 'npc_reaction', 'military.json'), 'utf8'));
    ok(written.hi_mid_1 === 'Move along.' && !Object.hasOwn(written, '__proto__') && tableJson(new Map([['a', 'b']])).a === 'b', "a table is written as its keys and words under the client's own path, and no key reaches a prototype");
    mkdirpWorld(out, 'tatooine');
    // The world's people written before the folder: status must not say the folder is older than them.
    const sp = join(out, 'tatooine', 'spawns.json');
    utimesSync(sp, new Date(0), new Date(0));
    const fresh = conversationsStatus(out, ref, ['tatooine']);
    const speakersFile = JSON.parse(readFileSync(join(out, 'conversations', 'speakers.json'), 'utf8'));
    ok(Array.isArray(speakersFile.tables) && speakersFile.tables.length === 2 && fresh.why === null, `the speakers name only the tables written, and with them all there status is quiet (${fresh.line.trim()})`);
    rmSync(join(out, 'conversations', 'strings', 'conversation', 'hera.json'));
    ok(/string tables/.test(conversationsStatus(out, ref, ['tatooine']).why ?? ''), 'a table it names gone, status asks again');
    writeConversations(out, plan, (t: string) => tables.get(t) ?? null, referenceHash(ref));
    const later = Date.now() / 1000 + 60;
    utimesSync(sp, later, later);
    ok(/converted again/.test(conversationsStatus(out, ref, ['tatooine']).why ?? ''), "a world's people converted again since, status asks again");
    utimesSync(sp, new Date(0), new Date(0));
    writeFileSync(join(ref, 'conversations.json'), '{"changed":1}\n');
    ok(/reference has changed/.test(conversationsStatus(out, ref, ['tatooine']).why ?? ''), 'the reference changed under it, status asks again');
    const core3 = JSON.parse(readFileSync(join(out, 'conversations', 'core3.json'), 'utf8'));
    writeFileSync(join(out, 'conversations', 'core3.json'), JSON.stringify({ ...core3, format: 0 }));
    ok(/older shape/.test(conversationsStatus(out, ref, ['tatooine']).why ?? ''), 'an older shape, status asks again');
    rmSync(join(out, 'conversations'), { recursive: true });
    ok(/none of the client's words/.test(conversationsStatus(out, ref, ['tatooine']).why ?? ''), 'and with none at all it asks for them');
    ok(packsUnder(out).length === 1 && packsUnder(out)[0].world === 'tatooine', 'the packs are every world beside it with a spawns.json');
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(ref, { recursive: true, force: true });
  }
}

/** A world's people, as `spawns` writes them: enough for status and the plan to find. */
function mkdirpWorld(out: string, world: string): void {
  const dir = join(out, world);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'spawns.json'), JSON.stringify({ format: 2, statics: packs[0].statics, pools: packs[0].pools }));
}

// ---- the browser's reading ------------------------------------------------------------------------------------------
{
  const adoption = [{ path: 'a.jsonc', text: JSON.stringify({ format: 1, credit: 'SWGEmu Core3', trees: { heraldTreeA: { waypoints: 'heralds' } } }) }];
  const pack = new ConversationPack();
  pack.adopt(plan.core3, plan.speakers, adoption);
  ok(pack.status === 'ready' && pack.voiced('herald_a') && !pack.voiced('rebel_guard') && pack.voiceOf('rebel_guard')?.diction === 'military', 'the browser folds what was written: the adopted herald is given its conversation, the guard only its way of speaking');
  ok(pack.standRows('tatooine').length === 1 && pack.standRows('naboo').length === 0 && pack.standRows('tatooine')[0] !== pack.standRows('tatooine')[0], 'it stands the heralds beside a world\'s people, a fresh copy each time');
  ok(pack.tablesFor('herald_a').join() === 'conversation/hera,spawning/static_npc/herald_x' && pack.tablesFor('rebel_guard').join() === 'npc_reaction/military' && pack.tablesFor('herald_a') === pack.tablesFor('herald_a'), "a creature's tables are its conversation's and its reaction table's, worked out once");
  ok(pack.whyNotReview('guardTree') === null && /not one of/.test(pack.whyNotReview('unusedTree') ?? ''), 'a tree written may be reviewed; one not written is said to be absent');
  // What the browser folds out of the written slice is what the server folds out of the whole: the same
  // conversation, hash and places, for the herald a pack stands as well as the one this command does.
  const whole = core3Set(captureOf(conversations), voicesOf(speakers), readOverlays(adoption).overlays);
  const id = 'core3:talk/heraldTreeA';
  ok(pack.set!.talks[id]?.hash === whole.set.talks[id].hash && whole.folds.heraldTreeA.playable && pack.voiced('herald_stood') && whole.set.voices!.herald_stood === id, 'the browser folds a herald as the server folds the whole reference: one hash, playable, whoever stands them');
  const place = pack.set!.talks[id].nodes.loc1.do.find((a) => a.act === 'waypoint');
  ok(!!place && place.args[0] === '@spawning/static_npc/herald_x:waypoint_name_1' && place.args[2] === 500 && place.args[3] === 600, "and marks the herald's place, named from the herald who names it nearby");
}

// ---- the browser's load: what it takes, and what it leaves ------------------------------------------------------------
{
  const serve = (files: Record<string, unknown>) => (url: string) => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    return Promise.resolve(name in files ? { ok: true, json: () => Promise.resolve(files[name]) } : { ok: false, json: () => Promise.resolve(null) });
  };
  const none = () => Promise.resolve([]);
  const absent = new ConversationPack();
  await absent.load('/', none, serve({ 'core3.json': plan.core3 }));
  ok(absent.status === 'absent' && absent.set === null && !absent.voiced('herald_a'), 'a folder with a file missing is absent, and nobody speaks from it');
  const old = new ConversationPack();
  await old.load('/', none, serve({ 'core3.json': { ...plan.core3, format: CONVERSATIONS_FORMAT + 1 }, 'speakers.json': plan.speakers }));
  ok(old.status === 'old' && old.set === null, 'one written in another shape is left unread, for status to ask for again');
  const rows = { ...plan.speakers, stand: { tatooine: [...plan.speakers.stand.tatooine, { key: 'bad', who: 'herald_x', id: 'b', x: 'far', y: 0, z: 0 }, { who: 'no_key', id: 'b', x: 0, y: 0, z: 0 }, null], naboo: 'nonsense' } };
  const good = new ConversationPack();
  await good.load('/', () => Promise.resolve([{ path: 'a.jsonc', text: JSON.stringify({ format: 1, credit: 'SWGEmu Core3', trees: { heraldTreeA: { waypoints: 'heralds' } } }) }]), serve({ 'core3.json': plan.core3, 'speakers.json': rows }));
  ok(good.status === 'ready' && good.standRows('tatooine').length === 1 && good.standRows('tatooine')[0].who === 'herald_a' && good.standRows('naboo').length === 0 && good.voiced('herald_a'), 'one of this shape is folded, and a row it stands with no key, a place that is not a number, or none at all is left out');
  const again = good.load('/', none, serve({}));
  ok((await again, good.status === 'ready'), 'and it is loaded once a session');
}

// ---- the owner's own conversion, where this machine has one --------------------------------------------------------
{
  const dir = fileURLToPath(new URL('../../../assets-private/conversations/', import.meta.url));
  if (!existsSync(join(dir, 'core3.json'))) note('no converted conversations on this machine (npm run swg -- conversations @SWG assets-private --retail-only), so the real folder is not checked');
  else {
    const core3 = JSON.parse(readFileSync(join(dir, 'core3.json'), 'utf8'));
    const sp = JSON.parse(readFileSync(join(dir, 'speakers.json'), 'utf8'));
    ok(core3.format === CONVERSATIONS_FORMAT && sp.format === CONVERSATIONS_FORMAT && typeof core3.ref === 'string', 'the converted folder is of this shape and says which reference it came from');
    const stood = Object.values(sp.stand as Record<string, { who: string }[]>).flat();
    ok(stood.length === 8 && stood.every((r) => /^herald_/.test(r.who)) && core3.heralds.multi.length === 8, `the eight heralds the server stood from its own table are stood (${stood.length})`);
    const lost = (sp.tables as string[]).filter((t) => !existsSync(join(dir, 'strings', ...`${t}.json`.split('/'))));
    ok(sp.tables.length > 100 && lost.length === 0, `every one of the ${sp.tables.length} tables it names is on disk`);
    for (const diction of ['military', 'stormtrooper', 'fancy', 'slang', 'townperson']) {
      const t = JSON.parse(readFileSync(join(dir, 'strings', 'npc_reaction', `${diction}.json`), 'utf8'));
      const keys = ['hi', 'bye'].flatMap((k) => ['nice', 'mid', 'mean'].flatMap((w) => Array.from({ length: 16 }, (_, i) => `${k}_${w}_${i + 1}`)));
      ok(keys.every((k) => typeof t[k] === 'string' && t[k].length > 0), `the ${diction} table has every one of its 96 greetings and farewells`);
    }
    const pack = new ConversationPack();
    pack.adopt(core3, sp, readStorySet(fileURLToPath(new URL('../../../src/story/core3/', import.meta.url))).files);
    ok(pack.voiced('herald_corellia_karin') && pack.standRows('corellia').some((r) => r.who === 'herald_corellia_karin') && !pack.voiced('herald_tatooine_errik'), "Coronet's herald is stood and speaks her conversation; Tatooine's second is stood and speaks none");
    // The browser's fold of what was converted against the server's fold of the whole reference: every
    // conversation somebody is given is the same conversation, hash, places and all, on both.
    const real = readCore3Story()!;
    const given = Object.keys(real.set.voices!).sort();
    const differ = given.filter((w) => {
      const id = real.set.voices![w];
      return !pack.voiced(w) || pack.set!.voices![w] !== id || pack.set!.talks[id]?.hash !== real.set.talks[id].hash;
    });
    const places = (set: typeof real.set, id: string) => JSON.stringify(Object.keys(set.talks[id].nodes).sort().flatMap((n) => set.talks[id].nodes[n].do.filter((a) => a.act === 'waypoint').map((a) => [n, ...a.args])));
    const placesDiffer = given.filter((w) => places(pack.set!, real.set.voices![w]) !== places(real.set, real.set.voices![w]));
    ok(given.length === 7 && differ.length === 0 && placesDiffer.length === 0, `the browser folds every herald the server gives a conversation to alike, hash and places (${given.length}; ${[...differ, ...placesDiffer].join(', ') || 'none differ'})`);
    const rebel = pack.voiceOf('rebel_trooper');
    ok(rebel?.diction === 'military' && rebel.faction === 'rebel', 'a rebel trooper greets in the military table, on the Rebellion\'s track');
  }
}

console.log(`\nconversations convert: ${checks} checks passed`);
