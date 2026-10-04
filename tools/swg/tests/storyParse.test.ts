// Reading a story's files: JSON with comments (`src/story/jsonc.ts`), the short expressions and the JSON
// each stands for (`src/story/expr.ts`), the spellings of a text (`src/story/text.ts`), the spans of time
// (`src/story/clock.ts`), and the loader that turns a folder into definitions (`src/story/set.ts`).
//
// The failures pinned. An error must name the line and column it was found at, or the owner is left
// hunting through a file by eye. A key the language gives a meaning to must never be read into an object.
// Every condition must come out as the JSON the design gives it, because that JSON is also what an
// importer writes by hand, and the two must be checked by one rule. A roll must carry where it was
// written, or two rolls in one quest would come up the same. A set's hash must not change with a
// checkout's line ends, or a server and a browser on two machines would disagree about holding the same
// story. And an id written plainly inside its own set must come out with that set's prefix.
//
// Everything is synthetic except the committed test set, which is read as the game reads it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lineAt, parseJsonc, pointer, where } from '../../../src/story/jsonc.ts';
import { parseAction, parseCondition } from '../../../src/story/expr.ts';
import { UNRESOLVED, cleanTextRef, clientKey, isTestText, literalOf, relativeKey, textKind, textOf } from '../../../src/story/text.ts';
import { GAME_DAY_MS, GAME_HOUR_MS, cleanSpan, gameDayOf, realDayOf } from '../../../src/story/clock.ts';
import { filesHash, joinSets, loadSet, readAction, stableText } from '../../../src/story/set.ts';
import { ACTIONS, CONDITIONS, COND_HEADS, STEP_TYPES, arity, argKindAt } from '../../../src/story/vocab.ts';
import { readStorySet } from '../../../server/storySet.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const same = (a: unknown, b: unknown) => stableText(a) === stableText(b);

// ---- JSONC ------------------------------------------------------------------------------------------
{
  const text = '// a comment\n{\n  "a": 1, /* inside */\n  "b": [1, 2, 3,],\n  "c": { "d": "x//not a comment" },\n}\n';
  const doc = parseJsonc(text);
  ok(doc.error === null && same(doc.value, { a: 1, b: [1, 2, 3], c: { d: 'x//not a comment' } }), 'line and block comments and trailing commas are read, and a // inside a string is not a comment');
  ok(lineAt(doc.lines, '/a') === 3 && lineAt(doc.lines, '/b/2') === 4 && lineAt(doc.lines, '/c/d') === 5, 'every value carries the line it starts on, by its JSON pointer');
  ok(lineAt(doc.lines, '/c/d/missing/deeper') === 5 && lineAt(doc.lines, '') === 2, 'and a path with no line of its own takes the nearest value it is inside');
  ok(pointer(['steps', 'a/b', 0]) === '/steps/a~1b/0', 'a pointer escapes a slash in a key');
  const bad = parseJsonc('{\n  "a": 1,\n  "b": tru\n}');
  ok(bad.error !== null && bad.error.line === 3 && bad.error.col === 8, `an error names its line and column (${where('x.jsonc', bad.error?.line ?? 0, bad.error?.col)})`);
  const unclosed = parseJsonc('{\n "a": "half\n}');
  ok(unclosed.error?.line === 2 && /run over a line/.test(unclosed.error.message), 'a string running over a line is refused where it breaks');
  const proto = parseJsonc('{ "__proto__": { "admin": true } }');
  ok(proto.error !== null && /may not be a key/.test(proto.error.message) && ({} as Record<string, unknown>).admin === undefined, 'a key the language gives a meaning to is refused, and nothing reaches the objects it would have been read into');
  ok(/given twice/.test(parseJsonc('{ "a": 1, "a": 2 }').error?.message ?? ''), 'the same key twice in one object is a mistake, and said so');
  ok(/never closed/.test(parseJsonc('{ /* open').error?.message ?? '') && parseJsonc('[1] 2').error !== null, 'an open comment and anything after the value are refused');
  ok(parseJsonc('﻿{"x": 1}').error === null, 'a byte-order mark at the start is taken off');
  ok(/too large/.test(parseJsonc('1e999').error?.message ?? '') && parseJsonc('[' + '['.repeat(70) + ']'.repeat(71)).error !== null, 'a number past a double and nesting past the depth are refused');
}

// ---- text ---------------------------------------------------------------------------------------------
{
  ok(textKind('@conversation/c_herald:s_1') === 'client' && textKind(':s_2') === 'relative' && textKind('TEST: words') === 'literal' && textKind({ en: '@not a ref' }) === 'literal', 'the four spellings of a text are told apart');
  ok(cleanTextRef('@bad ref') === null && cleanTextRef(':') === null && cleanTextRef('   ') === null && cleanTextRef('ok\u0001') === 'ok', 'a malformed reference, an empty text and control characters are cleaned or refused');
  ok(same(clientKey('@conversation/c_herald:s_1'), { table: 'conversation/c_herald', key: 's_1' }) && relativeKey(':s_2') === 's_2' && literalOf({ en: ':raw' }) === ':raw', 'a reference gives up its table and key, and a literal its words');
  ok(textOf('@t:k') === UNRESOLVED && textOf('@t:k', (t, k) => `${t}/${k}`) === 't/k' && textOf(':k', (t, k) => `${t}.${k}`, 'mine') === 'mine.k', 'a reference nobody can resolve shows […], and one resolved shows the words');
  ok(isTestText('TEST: x') && !isTestText('Real words') && isTestText('@t:k'), 'a literal text is labelled test content only when it begins TEST');
}

// ---- spans ------------------------------------------------------------------------------------------
{
  const s = cleanSpan({ gameHours: 1 });
  ok(typeof s !== 'string' && s.ms === 30000 && s.clock === 'world' && s.words === '1 game hour' && GAME_HOUR_MS === 30000, 'a game hour is the game\'s 720-second day over 24: thirty real seconds, on the world clock by default');
  const mixed = cleanSpan({ seconds: 30, realHours: 2, clock: 'played' });
  ok(typeof mixed !== 'string' && mixed.ms === 30000 + 7200000 && mixed.clock === 'played' && mixed.words === '2 hours and 30 seconds', 'units mix, and the played clock is kept');
  ok(typeof cleanSpan({}) === 'string' && typeof cleanSpan({ seconds: -1 }) === 'string' && typeof cleanSpan({ seconds: 1, minutes: 2 }) === 'string' && typeof cleanSpan({ gameDays: 1e6 }) === 'string', 'no unit, a negative one, an unknown one and a span past a year are refused');
  ok(gameDayOf(GAME_DAY_MS - 1) === 0 && gameDayOf(GAME_DAY_MS) === 1 && realDayOf(86400000 * 3 + 5) === 3, 'game and real days are counted from the shared clock\'s zero');
}

// ---- expressions ------------------------------------------------------------------------------------
{
  const c = (src: string) => {
    const r = parseCondition(src, '/needs');
    if ('error' in r) throw new Error(`${src}: ${r.error.message}`);
    return r.cond;
  };
  ok(same(c('questDone(test:goto)'), { quest: 'test:goto', is: 'done' }) && same(c('questDone(goto, late)'), { quest: 'goto', is: 'done', outcome: 'late' }), 'questDone, with and without its outcome');
  ok(same(c('questNone(q)'), { quest: 'q', is: 'none' }) && same(c('questOffered(q)'), { quest: 'q', is: 'offered' }) && same(c('questActive(q)'), { quest: 'q', is: 'active' }) && same(c('questFailed(q)'), { quest: 'q', is: 'failed' }) && same(c('closed(q)'), { quest: 'q', is: 'closed' }), 'every quest state reads into { quest, is }');
  ok(same(c('stepActive(q, a)'), { step: ['q', 'a'], is: 'active' }) && same(c('stepDone(q,a)'), { step: ['q', 'a'], is: 'done' }), 'step states read into { step: [q, s], is }');
  ok(same(c('completions(q) >= 2'), { completions: 'q', gte: 2 }) && same(c('flag(test.x)'), { flag: 'test.x', set: true }) && same(c('flag(test.x) == "open"'), { flag: 'test.x', eq: 'open' }) && same(c('flag(n) < -3'), { flag: 'n', lt: -3 }), 'comparisons become their keys, a bare flag is "set", and a number may carry a sign');
  ok(same(c('world(tatooine)'), { world: 'tatooine' }) && same(c('inArea(area/x)'), { inArea: 'area/x' }) && same(c('inRoom(cantina, object/building/tatooine/shared_cantina_tatooine.iff)'), { inRoom: { cell: 'cantina', template: 'object/building/tatooine/shared_cantina_tatooine.iff' } }), 'world, inArea and inRoom (an id may carry slashes, dots and a colon)');
  ok(same(c('gameHour() >= 18'), { hour: [18, 24] }) && same(c('gameHour() < 6'), { hour: [0, 6] }) && same(c('gameHour() == 12'), { hour: [12, 13] }) && same(c('gameHour() != 12'), { not: { hour: [12, 13] } }), 'the game hour compared becomes the range of hours it holds in');
  ok(same(c('inGroup()'), { grouped: true }) && same(c('species(human)'), { species: 'human' }) && same(c('call(test.always, 1, "a")'), { script: 'test.always', args: [1, 'a'] }), 'inGroup, species, and the named escape with its arguments');
  const rolls = c('roll(0.5) && roll(0.25)');
  ok(same(rolls, { all: [{ chance: 0.5, seed: '/needs#0' }, { chance: 0.25, seed: '/needs#1' }] }), 'each roll carries where it was written and its order there, so two rolls in one place differ');
  ok(same(c('!questDone(a) && (flag(x) || flag(y)) || true'), { any: [{ all: [{ not: { quest: 'a', is: 'done' } }, { any: [{ flag: 'x', set: true }, { flag: 'y', set: true }] }] }, { all: [] }] }), '! binds tightest, then &&, then ||; brackets group; true is the condition that always holds');
  ok(same(c('!flag(x) == 1'), { not: { flag: 'x', eq: 1 } }), 'a ! before a comparison negates the whole comparison');
  // Later waves: read into their JSON already, so the loader can say which wave they wait for.
  ok(same(c('credits() >= 50'), { credits: { gte: 50 } }) && same(c('has(wear, shirt_s03, 2)'), { has: { kind: 'wear', id: 'shirt_s03', n: 2 } }) && same(c('standing(freelance) > 10'), { standing: { track: 'freelance', gt: 10 } }), 'the fourth wave\'s conditions read into their JSON');
  ok(same(c('choiceOf(q, s) == "sign"'), { choice: ['q', 's'], eq: 'sign' }) && same(c('choiceOf(q, s) != "sign"'), { not: { choice: ['q', 's'], eq: 'sign' } }) && same(c('met(cast/clerk)'), { person: { who: 'cast/clerk', is: 'met' } }), 'a word compared becomes eq, and != its not');
  ok(same(c('fileLevel(isb) >= 2'), { file: { agency: 'isb', gte: 2 } }) && same(c('rankAtLeast(empire, r3)'), { rank: { track: 'empire', atLeast: 'r3' } }) && same(c('companionUp()'), { companion: { up: true } }) && same(c('debt(cast/x) > 0'), { debt: { to: 'cast/x', gt: 0 } }), 'and so do the eighth and ninth waves\'');
  const errs: [string, RegExp, number][] = [
    ['frobnicate(x)', /not a condition this game knows/, 0],
    ['questDone()', /takes 1 to 2 arguments/, 0],
    ['completions(q)', /has a value to compare/, 0],
    ['questDone(q) >= 1', /no value to compare/, 16],
    ['flag(x) > "word"', /compared only with == or !=/, 10],
    ['questDone(q) questDone(r)', /expected && or \|\|/, 13],
    ['(questDone(q)', /expected \)/, 13],
    ['questDone(q))', /a \) with no \(/, 12],
    ['roll(half)', /is a number/, 5],
    ['questDone("unclosed)', /never closed/, 10],
    ['gameHour() > 25', /0 to 24/, 13],
  ];
  for (const [src, re, at] of errs) {
    const r = parseCondition(src);
    ok('error' in r && re.test(r.error.message) && r.error.at === at, `"${src}" is refused where it goes wrong (${'error' in r ? `${r.error.message} at ${r.error.at}` : 'read'})`);
  }
  const a = parseAction('flag(test.branch, 2)');
  ok('act' in a && same(a.act, { act: 'flag', args: ['test.branch', 2] }), 'an action reads into { act, args }');
  ok('act' in parseAction('note("TEST: with a \\"quote\\" in it")') && (parseAction('note("TEST: with a \\"quote\\" in it")') as { act: { args: string[] } }).act.args[0] === 'TEST: with a "quote" in it', 'a string argument may carry an escaped quote');
  ok('error' in parseAction('grant(a) grant(b)') && 'error' in parseAction('nonsense(a)') && 'error' in parseAction('pay(1.5)') && 'error' in parseAction('close()'), 'two calls, an unknown action, a fraction where a whole number belongs and a rest argument left empty are refused');
}

// ---- the vocabulary ---------------------------------------------------------------------------------
{
  ok(arity(ACTIONS.close).min === 1 && arity(ACTIONS.close).max === Infinity && arity(CONDITIONS.questDone).min === 1 && arity(CONDITIONS.questDone).max === 2, 'a rest argument and an optional one count as the spec says');
  ok(argKindAt(ACTIONS.close, 5) === 'quest' && argKindAt(ACTIONS.call, 3) === 'any' && argKindAt(CONDITIONS.inRoom, 1) === 'template' && argKindAt(CONDITIONS.inRoom, 2) === null, 'and every argument has its kind');
  ok(['impound', 'licence', 'district', 'take', 'misfile'].every((n) => ACTIONS[n]?.reserved) && ['collect', 'give', 'carry', 'killLoot', 'pay', 'encounter', 'spawn', 'waves', 'escort', 'perform', 'craft', 'space'].every((n) => STEP_TYPES[n]?.reserved), 'the five actions and twelve step types kept for later passes are marked so');
  const heads = new Set(Object.keys(COND_HEADS));
  let shapes = 0;
  for (const name of Object.keys(CONDITIONS)) {
    const spec = CONDITIONS[name];
    const args = spec.args.filter((x) => !x.endsWith('?') && !x.endsWith('*')).map((k) => (k.startsWith('number') || k.startsWith('int') ? 1 : 'x'));
    const src = `${name}(${args.join(', ')})${spec.value === 'number' ? ' >= 1' : spec.value === 'string' ? ' == "x"' : ''}`;
    const r = parseCondition(src);
    if ('error' in r) throw new Error(`${src}: ${r.error.message}`);
    const head = Object.keys('not' in r.cond ? (r.cond.not as object) : r.cond).find((k) => heads.has(k));
    if (head) shapes++;
  }
  ok(shapes === Object.keys(CONDITIONS).length, `every one of the ${shapes} conditions reads into a JSON whose head the loader knows`);
}

// ---- the loader ---------------------------------------------------------------------------------------
{
  // Written over several lines each, with a comment, as a person writes them: a line end has to be in the
  // text for a checkout's own line ends to be able to change it.
  const files = [
    { path: 'story.jsonc', text: '// mine\n{\n  "prefix": "own",\n  "title": "Mine"\n}\n' },
    { path: 'objects/desk.jsonc', text: '{\n  "id": "desk",\n  "world": "tatooine",\n  "template": "object/x.iff",\n  "near": [1, 2]\n}\n' },
    { path: 'areas/yard.jsonc', text: '{\n  "id": "yard",\n  "world": "tatooine",\n  "shape": { "kind": "rect", "min": [10, 10], "max": [0, 0] }\n}\n' },
    {
      path: 'quests/a.jsonc',
      text: '{\n  "id": "a",\n  "title": "A",\n  "needs": "questDone(b)",\n  "givers": [{ "kind": "use", "object": "obj/desk" }],\n  "start": ["s"],\n  "steps": {\n    "s": { "type": "signal", "signal": "used:obj/desk", "grant": { "done": "b" }, "next": ["t"] },\n    "t": { "type": "signal", "signal": "ping", "do": { "done": ["grant(test:x)"] }, "ends": "done" }\n  }\n}\n',
    },
    { path: 'quests/b.jsonc', text: '{\n  "id": "b",\n  "title": "B",\n  "start": ["s"],\n  "steps": { "s": { "type": "nothing" } }\n}\n' },
    { path: 'fixtures/broken.jsonc', text: 'not even json' },
    { path: 'ladders.jsonc', text: '{}' },
  ];
  const r = loadSet(files);
  const q = r.set.quests['own:a'];
  ok(r.errors.length === 0 && !!q && !!r.set.quests['own:b'] && r.set.prefix === 'own' && !r.set.test, `a set reads, its ids prefixed with its own (${r.errors.map((e) => e.message).join('; ')})`);
  ok(same(q.needs, { quest: 'own:b', is: 'done' }) && q.steps.s.grant.done[0] === 'own:b' && q.givers[0].kind === 'use' && (q.givers[0] as { object: string }).object === 'own:obj/desk', 'a reference inside the set without its prefix gets the set\'s');
  ok(q.steps.s.signal === 'used:own:obj/desk' && q.steps.t.signal === 'own:ping' && q.steps.t.do.done[0].args[0] === 'test:x', 'an engine signal\'s own id is prefixed, a plain signal is the set\'s own, and a reference into another set keeps its prefix');
  ok(!!r.set.objects['own:obj/desk'] && same(r.set.areas['own:area/yard'].shape, { kind: 'rect', min: [0, 0], max: [10, 10] }), 'objects and areas take their kind into their id, and a rect\'s corners are put in order');
  ok(r.set.later.includes('ladders.jsonc') && r.warnings.some((w) => /wave 9/.test(w.message)) && !r.errors.some((e) => e.file.startsWith('fixtures/')), 'a later wave\'s file is noted and not read, and the fixtures are never loaded at all');
  ok(/^[0-9a-f]{16}$/.test(q.hash) && q.hash !== r.set.quests['own:b'].hash, 'every quest carries a hash of its own definition');
  const crlfFiles = files.map((f) => ({ ...f, text: f.text.replace(/\n/g, '\r\n') }));
  const crlf = loadSet(crlfFiles);
  const moved = loadSet([...files].reverse());
  const changed = crlfFiles.filter((f, i) => f.text !== files[i].text).length;
  ok(changed >= 5 && crlf.errors.length === 0 && crlf.hash === r.hash && moved.hash === r.hash && crlf.set.quests['own:a'].hash === q.hash, `the set's hash does not change with a checkout's line ends (${changed} of the files' texts really differ) or the order the files were listed in`);
  ok(filesHash(crlfFiles) !== filesHash(files), 'while the same texts hashed as they stand do differ, so it is the loader making line ends plain that keeps the two the same');
  const bom = loadSet(files.map((f) => ({ ...f, text: `﻿${f.text}` })));
  ok(bom.hash === r.hash && bom.errors.length === 0, 'and so does a byte-order mark an editor puts at the start of each file');
  // The committed test set as a checkout with Windows line ends hands it over, and as one without.
  const tsFiles = readStorySet(fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url))).files;
  const lf = tsFiles.map((f) => ({ ...f, text: f.text.replace(/\r\n/g, '\n') }));
  const cr = lf.map((f) => ({ ...f, text: f.text.replace(/\n/g, '\r\n') }));
  ok(lf.some((f, i) => f.text !== cr[i].text) && loadSet(lf, { test: true }).hash === loadSet(cr, { test: true }).hash, 'the committed test set hashes the same with either line ends');
  const edited = loadSet(files.map((f) => (f.path === 'quests/b.jsonc' ? { ...f, text: f.text.replace('"B"', '"B2"') } : f)));
  ok(edited.hash !== r.hash && edited.set.quests['own:b'].hash !== r.set.quests['own:b'].hash && edited.set.quests['own:a'].hash === q.hash, 'an edit changes the set\'s hash and the edited quest\'s, and no other quest\'s');
  ok(filesHash([{ path: 'a', text: 'bc' }]) !== filesHash([{ path: 'ab', text: 'c' }]), 'a path and its text cannot run into each other in the hash');

  const broken = loadSet([
    files[0],
    { path: 'quests/c.jsonc', text: '{\n  "id": "c",\n  "title": "C",\n  "start": ["s"],\n  "steps": {\n    "s": { "type": "signal", "signal": "x", "timeLimit": { "minutes": 2 } },\n    "t": { "type": "goto", "at": { "rel": "start", "dx": 1, "dz": 1 } },\n    "u": { "type": "collect" },\n    "v": { "type": "nothing", "canonical": true }\n  }\n}' },
  ]);
  const at = (re: RegExp) => broken.errors.find((e) => re.test(e.message));
  ok(at(/minutes is not part of a span/)?.line === 6, 'a bad span is refused on its own line');
  ok(at(/only in the test set/)?.line === 7 && at(/only in the test set/)?.rule === 8, 'a relative place outside the test set is refused, as rule 8');
  ok(at(/kept for a later pass/)?.line === 8 && at(/kept for a later pass/)?.rule === 4, 'a step type kept for a later pass is refused, as rule 4');
  ok(at(/canonical or true/)?.line === 9 && at(/canonical or true/)?.rule === 10, 'a field claiming to be canonical is refused, as rule 10');
  const noStory = loadSet([{ path: 'quests/a.jsonc', text: '{}' }]);
  ok(noStory.errors.length === 1 && /story\.jsonc/.test(noStory.errors[0].message), 'a set without its story.jsonc says so');
  ok(loadSet([{ path: 'story.jsonc', text: '{ "prefix": "used" }' }]).errors.length === 1 && loadSet([{ path: 'story.jsonc', text: '{ "prefix": "Own" }' }]).errors.length === 1, 'a prefix that is an engine word or not lower case is refused');
  ok(same(readAction('grant(goto)', 'test'), { act: 'grant', args: ['test:goto'], wave: 3 }) && typeof readAction('impound(x)', 'test') === 'string', 'an action from the console reads as a file\'s would, prefixed with the test set\'s');
  const joined = joinSets([r.set, loadSet([{ path: 'story.jsonc', text: '{ "prefix": "test" }' }], { test: true }).set, r.set]);
  ok(joined.name === 'own+test' && joined.sets.length === 2 && joined.test && !!joined.quests['own:a'], 'two sets join, side by side, and the same prefix twice is taken once');
  // Only the caller reading the committed test set may say it is that: a folder calling itself `test`
  // would otherwise have the test set's allowances (relative places, console signals).
  const impostor = loadSet([{ path: 'story.jsonc', text: '{ "prefix": "test", "title": "mine" }' }, { path: 'quests/rel.jsonc', text: '{ "id": "rel", "title": "TEST", "start": ["a"], "steps": { "a": { "type": "goto", "at": { "rel": "start", "dx": 1, "dz": 1 }, "ends": "done" } } }' }]);
  ok(impostor.errors.length === 1 && /test set's/.test(impostor.errors[0].message) && !impostor.set.test && Object.keys(impostor.set.quests).length === 0, 'a set that declares the test set\'s prefix without being loaded as the test set is refused, and read no further');
  ok(!r.set.test && !loadSet(files, {}).set.test && loadSet(files, { test: true }).set.test, 'and nothing is the test set unless the caller says so');

  // The fourth wave's conditions as an importer writes them, as JSON: each malformed one refused in its
  // own words, and the well-formed ones read.
  const needs = (id: string, cond: unknown) => ({ path: `quests/${id}.jsonc`, text: JSON.stringify({ id, title: 'TEST', needs: cond, start: ['s'], steps: { s: { type: 'nothing' } } }) });
  const fourth = loadSet([
    files[0],
    needs('c1', { credits: { gte: '5' } }),
    needs('c2', { credits: { gte: 1, lt: 9 } }),
    needs('c3', { credits: { about: 1 } }),
    needs('h1', { has: { kind: 'ship', id: 'x' } }),
    needs('h2', { has: { kind: 'wear', id: 'x', colour: 1 } }),
    needs('h3', { has: { kind: 'wear', id: 'x', n: 0 } }),
    needs('s1', { standing: { track: 'hutt', gte: 1 } }),
    needs('s2', { trust: { track: 'empire', gte: 1, lte: 5 } }),
    needs('s3', { standing: { track: 'empire' } }),
    needs('good', { all: [{ credits: { gte: 5 } }, { has: { kind: 'weapon', id: 'pistol_dl44', n: 2 } }, { standing: { track: 'freelance', gte: 2 } }, { trust: { track: 'rebellion', lt: 0 } }] }),
  ]);
  const errIn = (file: string, re: RegExp) => fourth.errors.some((e) => e.file === `quests/${file}.jsonc` && re.test(e.message));
  ok(errIn('c1', /credits is/) && errIn('c2', /credits is/) && errIn('c3', /credits is/), 'credits compared with a word, with two comparisons, or with one the game does not know is refused');
  ok(errIn('h1', /has is/) && errIn('h2', /names a kind, an id and how many/) && errIn('h3', /whole number from 1/), 'has naming a kind the ledger has not, a field it has not, or none of a thing is refused');
  ok(errIn('s1', /standing is/) && errIn('s2', /trust compares/) && errIn('s3', /standing compares/), 'Standing or Trust on a track the game has not, with two comparisons or with none is refused');
  ok(!fourth.errors.some((e) => e.file === 'quests/good.jsonc') && same(fourth.set.quests['own:good']?.needs, { all: [{ credits: { gte: 5 } }, { has: { kind: 'weapon', id: 'pistol_dl44', n: 2 } }, { standing: { track: 'freelance', gte: 2 } }, { trust: { track: 'rebellion', lt: 0 } }] }), 'and the four written well are read as they were written');
}

// ---- the committed test set, read as the game reads it ------------------------------------------------
{
  const dir = new URL('../../../src/story/testSet/', import.meta.url);
  const { files, refused } = readStorySet(decodeURIComponent(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1')));
  const r = loadSet(files, { test: true });
  ok(refused.length === 0 && r.errors.length === 0 && r.set.test && r.set.prefix === 'test', `the test set reads with no errors (${r.errors.map((e) => `${e.file}:${e.line} ${e.message}`).join('; ')})`);
  // The design's eleven, the fourth wave's own (`words`: what a job hands over and reads), the sixth's two (a talk step and a
  // choice), and the eighth's four (documents and a call, a card, a document that depends on a choice, an entry in the file).
  const want = ['goto', 'signal', 'kill', 'timer', 'join', 'reward', 'repeat', 'harsh', 'branchNext', 'observe', 'waypoints', 'words', 'talk', 'choice', 'docs', 'card', 'branchDoc', 'file'].map((q) => `test:${q}`);
  ok(want.every((q) => r.set.quests[q]) && Object.keys(r.set.quests).length === want.length, `it holds exactly the design's eleven test quests, the fourth wave's twelfth, the sixth wave's two and the eighth's four (${Object.keys(r.set.quests).join(', ')})`);
  ok(Object.keys(r.set.docs ?? {}).length === 6 && !!r.set.file?.isb && r.set.calendar?.text === '[TEST DATE]', 'and its six documents, its file and its calendar, which prints only "[TEST DATE]"');
  ok(r.warnings.every((w) => !/arrive[s]? in wave 4/.test(w.message)), 'and none of its words waits for the fourth wave any more');
  const fixtures = files.filter((f) => f.path.startsWith('fixtures/'));
  ok(fixtures.length === 6 && !Object.keys(r.set.quests).some((q) => q.includes('broken')), 'its six fixtures are in the folder and never loaded');
  const manifest = readFileSync(new URL('story.jsonc', dir), 'utf8');
  ok(/"TEST SET"/.test(manifest), 'and it is titled TEST SET');
}

console.log(`\n${checks} checks passed`);
