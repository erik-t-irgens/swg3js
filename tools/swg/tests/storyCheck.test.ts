// The checker (`src/story/check.ts`) and its command line (`npm run story:check`, `tools/story/check.mjs`):
// the committed test set passes it, every fixture built to fail it fails with the rule it was built for,
// and each of the design's rules the fixtures leave out is tried on a set made up here.
//
// The failures pinned. A set that would leave a player stuck -- a step nothing reaches, a step that can
// never finish, a signal nothing raises -- must be refused before anybody plays it, with the file and the
// line. Trust must never be grindable, nor move outside a choice under pressure. A journal note must never
// stand where the player might not have been. And the committed test set must stay labelled TEST from end
// to end, since it is the one piece of story content the repository carries.
//
// The creature catalogue is the owner's converted pack: where `assets-private` has one, the test set's kill
// targets are checked against it; where it does not, that one check is skipped with a line.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSet, issueLine, type CheckOptions } from '../../../src/story/check.ts';
import { loadSet, type StorySet } from '../../../src/story/set.ts';
import { isTestText, type TextRef } from '../../../src/story/text.ts';
import { FILE_MAX, readStorySet } from '../../../server/storySet.mjs';
import { catalogueOf, checkFolder, defaultFolders, worldIds } from '../../story/check.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TESTSET = join(ROOT, 'src', 'story', 'testSet');
const worlds = worldIds();
const { files } = readStorySet(TESTSET);
const testFiles = files.filter((f) => !f.path.startsWith('fixtures/'));
const fixtures = files.filter((f) => f.path.startsWith('fixtures/'));

// ---- the test set passes ------------------------------------------------------------------------------
{
  const cat = catalogueOf(ROOT);
  const r = checkSet(loadSet(testFiles, { test: true }), { worlds, catalogue: cat });
  ok(r.errors.length === 0, `the committed test set has no errors (${r.errors.map((e) => issueLine(e)).join('; ')})`);
  ok(r.counts.quests === 18 && r.counts.areas === 1 && r.counts.objects === 1 && r.counts.talks === 2 && r.counts.cast === 3 && r.counts.docs === 6 && r.counts.signals > 0, `and the checker read all of it (${JSON.stringify(r.counts)})`);
  ok(r.warnings.every((w) => /debug:|companion arrives/.test(w.message)), `its only warnings are its console signals, which the test set alone may wait on, and the companion a later wave brings (${r.warnings.filter((w) => !/debug:|companion arrives/.test(w.message)).map((w) => issueLine(w)).join('; ')})`);
  if (cat) ok(!r.warnings.some((w) => w.rule === 13), `its kill targets are all in this machine's creature catalogue (${cat.ids.size} entries)`);
  else console.log('skip the kill targets against the catalogue: assets-private/mobiles/catalogue.json is not on this machine');
}

// ---- every fixture fails with the rule it was built for -------------------------------------------------
{
  ok(fixtures.length === 6, `six fixtures (${fixtures.map((f) => f.path).join(', ')})`);
  for (const f of fixtures) {
    const want = Number(/expect: rule (\d+)/.exec(f.text)?.[1]);
    const r = checkSet(loadSet([...testFiles, { path: `quests/${f.path.slice('fixtures/'.length)}`, text: f.text }], { test: true }), { worlds });
    const hit = r.errors.find((e) => e.rule === want);
    ok(!!want && !!hit && hit.file.endsWith(f.path.slice('fixtures/'.length)) && hit.line > 1, `${f.path} fails rule ${want}, at its own line (${hit ? issueLine(hit) : r.errors.map((e) => issueLine(e)).join('; ') || 'no error'})`);
  }
}

// ---- every literal text in the test set is labelled TEST -----------------------------------------------------
{
  const set = loadSet(testFiles, { test: true }).set;
  const texts: [string, TextRef | null][] = [];
  for (const id of Object.keys(set.quests)) {
    const q = set.quests[id];
    texts.push([`${id} title`, q.title], [`${id} stakes`, q.stakes]);
    for (const s of Object.keys(q.steps)) {
      const st = q.steps[s];
      texts.push([`${id}#${s} objective`, st.objective]);
      for (const a of [...st.do.start, ...st.do.done, ...st.do.fail]) if (a.act === 'say' || a.act === 'note') texts.push([`${id}#${s} ${a.act}`, a.args[0] as string]);
    }
  }
  for (const id of Object.keys(set.areas)) texts.push([id, set.areas[id].label]);
  for (const id of Object.keys(set.objects)) texts.push([id, set.objects[id].label]);
  const bad = texts.filter(([, t]) => t !== null && !isTestText(t));
  ok(texts.filter(([, t]) => t !== null).length > 20 && bad.length === 0, `every text the test set carries is labelled TEST (${bad.map(([w]) => w).join(', ') || `${texts.length} looked at`})`);
  ok(set.title === 'TEST SET' && fixtures.every((f) => /"title": "TEST: /.test(f.text)), 'and so is the set itself and every fixture');
}

// ---- the rules the fixtures leave out, on sets made up here ------------------------------------------------------
const quest = (id: string, body: Record<string, unknown>) => ({ path: `quests/${id}.jsonc`, text: JSON.stringify({ id, title: 'TEST', givers: [{ kind: 'debug' }], ...body }) });
/** A set made up here, checked; one with the test set's prefix is loaded as the test set, as only its own folder ever is. */
const check = (prefix: string, qs: { path: string; text: string }[], opts: CheckOptions = {}, extra: { path: string; text: string }[] = []) => checkSet(loadSet([{ path: 'story.jsonc', text: JSON.stringify({ prefix, title: 'TEST' }) }, ...qs, ...extra], { test: prefix === 'test' }), { worlds, ...opts });
const has = (r: ReturnType<typeof checkSet>, rule: number, re: RegExp) => r.errors.some((e) => e.rule === rule && re.test(e.message));
const warns = (r: ReturnType<typeof checkSet>, re: RegExp) => r.warnings.some((w) => re.test(w.message));
{
  const refs = check('own', [
    quest('a', {
      start: ['s', 'ghost'],
      needs: 'questDone(nope) || stepDone(own:b, nostep) || inArea(area/none)',
      steps: { s: { type: 'use', object: 'obj/none', next: ['missing'], grant: { done: ['own:nope2'] }, do: { done: ['complete(own:b, zz)', 'end(own:b, nowhere)'] }, ends: 'undeclared' } },
    }),
    quest('b', { start: ['s'], steps: { s: { type: 'nothing' } } }),
  ]);
  for (const [re, what] of [
    [/start names ghost/, 'a start step that is not there'],
    [/own:nope is not a quest/, 'a quest a condition names that is not there'],
    [/own:b has no step nostep/, 'a step of another quest that is not there'],
    [/there is no area own:area\/none/, 'an area that is not there'],
    [/there is no object own:obj\/none/, 'an object that is not there'],
    [/goes on to missing/, 'a next step that is not there'],
    [/own:nope2 is not a quest/, 'a quest a step grants that is not there'],
    [/own:b has no step zz/, 'a step an action completes that is not there'],
    [/own:b has no outcome nowhere/, 'an outcome an action ends with that is not declared'],
    [/undeclared, which the quest does not declare/, 'an outcome a step ends with that is not declared'],
  ] as [RegExp, string][])
    ok(has(refs, 1, re), `rule 1: ${what}`);
  ok(warns(check('own', [quest('a', { start: ['s'], needs: 'questDone(other:x)', steps: { s: { type: 'nothing' } } })]), /other set, which is not loaded here/), 'rule 1: a quest in a set that is not loaded is warned about, since it cannot be checked');

  const graph = check('own', [
    quest('g', {
      start: ['a'],
      steps: {
        a: { type: 'signal', signal: 'debug:x', next: ['b'] },
        b: { type: 'signal', signal: 'debug:x', next: ['a'] },
        c: { type: 'join', after: ['ghostly'] },
        d: { type: 'signal', signal: 'debug:x', after: ['c'], next: ['d2'] },
        d2: { type: 'nothing', next: ['d'], loop: true },
      },
    }),
  ]);
  ok(has(graph, 2, /b points back to a/), 'rule 2: an edge back to an earlier step, from a step not marked loop, is refused');
  ok(has(graph, 2, /a can be reached and never finish/) && has(graph, 2, /b can be reached and never finish/), 'rule 2: a circle with no way out can be reached and never finish');
  ok(has(graph, 2, /c can never be reached/), 'rule 2: a step nothing leads to');
  const loopOk = check('own', [quest('l', { start: ['a'], steps: { a: { type: 'signal', signal: 'debug:x', next: ['b'] }, b: { type: 'signal', signal: 'debug:y', loop: true, next: ['a', 'end'] }, end: { type: 'end' } } })]);
  ok(!loopOk.errors.some((e) => e.rule === 2), 'but a loop marked so, with a way out, is fine');
  ok(warns(check('own', [quest('w', { start: ['a'], steps: { a: { type: 'signal', signal: 'debug:x' } } })]), /goes nowhere, so the quest ends done by itself/), 'a step that goes nowhere is warned: the quest ends done by itself');
  ok(warns(check('own', [quest('w', { start: ['a'], steps: { a: { type: 'nothing', next: ['b'], ends: 'done' }, b: { type: 'nothing' } } })]), /next is never followed/), 'a step that both ends the quest and goes on is warned');
  const after = check('own', [quest('af', { start: ['a'], steps: { a: { type: 'join', after: ['z'], ends: 'done' }, z: { type: 'nothing' } } })]);
  ok(has(after, 2, /waits on z, which can never be done/), 'rule 2: a step waiting after one that can never be reached');

  ok(has(check('own', [quest('d', { start: ['a'], steps: { a: { type: 'signal', signal: 'debug:x', ends: 'done' } } })]), 3, /console signals are only for the test set/), 'rule 3: a console signal outside the test set is an error');
  ok(has(check('own', [quest('o', { start: ['a'], steps: { a: { type: 'observe', area: 'area/none', seconds: 5, ends: 'done' } } })]), 3, /nothing raises/), 'rule 3: an observe step on an area that is not declared waits on nothing');
  const raised = check('own', [quest('r', { start: ['a'], steps: { a: { type: 'signal', signal: 'word', ends: 'done' } } }), quest('s', { start: ['a'], steps: { a: { type: 'nothing', do: { done: ['signal(word)'] } } } })]);
  ok(!raised.errors.some((e) => e.rule === 3), 'rule 3: a signal another quest\'s action raises has its raiser');
  ok(warns(check('test', [quest('lv', { start: ['a'], steps: { a: { type: 'signal', signal: 'entered:area/x', n: 3, ends: 'done' } } })], {}, [{ path: 'areas/x.jsonc', text: JSON.stringify({ id: 'x', world: 'tatooine', shape: { kind: 'circle', c: [0, 0], r: 5 } }) }]), /counts the repeats/), 'a signal the engine repeats while it stays true, counted past one, is warned');

  const trust = check('own', [
    quest('t1', { start: ['a'], steps: { a: { type: 'nothing', do: { done: ['trust(empire, 1)'] }, ends: 'done' } } }),
    quest('t2', { start: ['a'], steps: { a: { type: 'choice', options: [{ id: 'yes', label: 'TEST: yes', pressure: true, do: ['trust(empire, 1)'], ends: 'done' }, { id: 'no', label: 'TEST: no', do: ['trust(rebellion, 1)'], ends: 'done' }] } } }),
    quest('t3', { repeat: { every: 'always' }, start: ['a'], steps: { a: { type: 'nothing', do: { done: ['close(own:t1)'] }, ends: 'done' } } }),
  ]);
  ok(has(trust, 5, /Trust moves only under pressure/) && trust.errors.filter((e) => e.rule === 5 && e.file === 'quests/t2.jsonc').length === 1, 'rule 5: Trust in a plain step, or on an option not under pressure, is refused, and on one under pressure is not');
  ok(has(trust, 5, /may not close anything/), 'rule 5: a repeatable quest may not close anything');

  const notes = check('own', [
    quest('n1', { start: ['a'], steps: { a: { type: 'timer', for: { seconds: 5 }, do: { done: ['note("TEST: done")'] }, ends: 'done' } } }),
    quest('n2', { start: ['a'], steps: { a: { type: 'signal', signal: 'word', timeLimit: { seconds: 5 }, do: { fail: ['note("TEST: late")'] }, ends: 'done' } } }),
    quest('n3', { start: ['a'], steps: { a: { type: 'signal', signal: 'word', do: { done: ['note("TEST: heard")'] }, ends: 'done' } } }),
    quest('n4', { start: ['a'], steps: { a: { type: 'nothing', signalsOut: { done: ['word'] } } } }),
    quest('n5', { start: ['a'], steps: { a: { type: 'timer', for: { seconds: 5, clock: 'played' }, do: { done: ['note("TEST: fine")'] }, ends: 'done' } } }),
  ]);
  ok(has(notes, 6, /n1|world clock/) && notes.errors.some((e) => e.rule === 6 && e.file === 'quests/n1.jsonc'), 'rule 6: no note on a timer the world clock runs out');
  ok(notes.errors.some((e) => e.rule === 6 && e.file === 'quests/n2.jsonc'), 'rule 6: nor on a world-clock time limit\'s failure');
  ok(notes.errors.some((e) => e.rule === 6 && e.file === 'quests/n3.jsonc' && /another step raises/.test(e.message)), 'rule 6: nor on a signal another quest raises');
  ok(!notes.errors.some((e) => e.rule === 6 && e.file === 'quests/n5.jsonc'), 'but a played clock runs out only while the player is there');

  const where = check('own', [quest('p', { start: ['a'], steps: { a: { type: 'goto', at: { world: 'hoth', raw: [0, 0] }, ends: 'done' } } })], {}, [{ path: 'objects/o.jsonc', text: JSON.stringify({ id: 'o', world: 'bespin', template: 'object/x.iff', near: [0, 0] }) }]);
  ok(has(where, 7, /hoth is not a world/) && has(where, 7, /bespin is not a world/), 'rule 7: a world this game does not have, on a place or an object');
  ok(loadSet([{ path: 'story.jsonc', text: '{ "prefix": "own" }' }, quest('sp', { start: ['a'], steps: { a: { type: 'goto', at: { world: 'space_tatooine', raw: [0, 0] }, ends: 'done' } } })]).errors.some((e) => e.rule === 7 && /space zone/.test(e.message)), 'rule 7: a space zone\'s place in the raw frame is refused');

  const charge = check('own', [
    quest('c', {
      start: ['a'],
      steps: {
        a: {
          type: 'choice',
          options: [
            { id: 'pay', label: 'TEST: pay', when: 'credits() >= 50', do: ['charge(50)'], ends: 'done' },
            { id: 'cheat', label: 'TEST: cheat', when: 'credits() >= 10', do: ['charge(50)'], ends: 'done' },
            { id: 'free', label: 'TEST: free', do: ['charge(5)'], ends: 'done' },
          ],
        },
      },
    }),
  ]);
  ok(charge.errors.filter((e) => e.rule === 9).length === 2 && has(charge, 9, /cheat charges 50/) && has(charge, 9, /free charges 5/), 'rule 9: a charge must stand on a choice that asks for at least that much');

  const cat = { ids: new Set(['kreetle']), groups: new Set(['creatures/critter']), socials: new Set(['kreetle']), tags: new Set(['critter']) };
  const kills = check('own', [quest('k', { start: ['a'], steps: { a: { type: 'kill', who: ['wampa'], social: 'kreetle', n: 1, ends: 'done' } } })], { catalogue: cat });
  ok(kills.warnings.some((w) => w.rule === 13 && /wampa/.test(w.message)) && !kills.warnings.some((w) => w.rule === 13 && /social group/.test(w.message)) && !kills.errors.some((e) => e.rule === 13), 'rule 13: a kill target not in the catalogue is a warning, not an error');
  const escapes = check('own', [quest('e', { start: ['a'], needs: 'call(nothing.registered)', steps: { a: { type: 'nothing', do: { done: ['call(also.nothing)', 'call(test.setFlag, x, 1)'] }, ends: 'done' } } })]);
  ok(escapes.counts.unresolved === 2 && escapes.warnings.filter((w) => w.rule === 14).length === 2, 'rule 14: every call that names no registered script is counted');
  ok(escapes.errors.length === 0, 'and is not an error: an importer\'s untranslated piece leaves a quest stuck, not a set broken');
}

// ---- rule 2 for steps waiting on others, and for circles of quests -------------------------------------------------
{
  const join = (after: string[], extra: Record<string, unknown> = {}) => ({ type: 'join', after, ends: 'done', ...extra });
  const skip = check('own', [
    quest('u', { start: ['a', 'b'], steps: { a: { type: 'signal', signal: 'debug:a', unless: ['b'], next: ['meet'] }, b: { type: 'signal', signal: 'debug:b', next: ['meet'] }, meet: join(['a', 'b']) } }),
    quest('c', { start: ['a', 'b'], steps: { a: { type: 'signal', signal: 'debug:a', chance: 0.5, next: ['meet'] }, b: { type: 'signal', signal: 'debug:b', next: ['meet'] }, meet: join(['a', 'b']) } }),
    quest('h', { start: ['a', 'b'], steps: { a: { type: 'signal', signal: 'debug:a', chance: 0.5, next: ['meet'] }, b: { type: 'signal', signal: 'debug:b', next: ['meet'] }, meet: join(['a', 'b'], { onStuck: 'skip' }) } }),
  ]);
  ok(skip.errors.some((e) => e.rule === 2 && e.file === 'quests/u.jsonc' && /waits on a, which may be skipped \(unless b\)/.test(e.message)), 'rule 2: a step waiting after one that is skipped when another is done waits for ever');
  ok(skip.errors.some((e) => e.rule === 2 && e.file === 'quests/c.jsonc' && /a chance of 0\.5/.test(e.message)), 'rule 2: so does one waiting after a step whose roll may not come up');
  ok(!skip.errors.some((e) => e.rule === 2 && e.file === 'quests/h.jsonc'), 'but one whose onStuck says what happens then is let be');
  const fork = check('own', [
    quest('n', { start: ['f'], steps: { f: { type: 'signal', signal: 'debug:f', nextOne: [{ to: 'a', when: 'flag(z)' }, { to: 'b' }] }, a: { type: 'nothing', next: ['meet'] }, b: { type: 'nothing', next: ['meet'] }, meet: join(['a', 'b']) } }),
    quest('o', { start: ['f'], steps: { f: { type: 'choice', options: [{ id: 'x', label: 'TEST: x', next: ['a'] }, { id: 'y', label: 'TEST: y', next: ['b'] }] }, a: { type: 'nothing', next: ['meet'] }, b: { type: 'nothing', next: ['meet'] }, meet: join(['a', 'b']) } }),
    quest('w', { start: ['f'], steps: { f: { type: 'signal', signal: 'debug:f', next: [{ to: 'a', when: 'flag(z)' }, { to: 'b', when: '!flag(z)' }] }, a: { type: 'nothing', next: ['meet'] }, b: { type: 'nothing', next: ['meet'] }, meet: join(['a', 'b']) } }),
    quest('p', { start: ['f'], steps: { f: { type: 'signal', signal: 'debug:f', next: ['a', 'b'] }, a: { type: 'nothing', next: ['meet'] }, b: { type: 'nothing', next: ['meet'] }, meet: join(['a', 'b']) } }),
  ]);
  ok(fork.errors.some((e) => e.rule === 2 && e.file === 'quests/n.jsonc' && /only one branch of f's nextOne/.test(e.message)), 'rule 2: a join after two steps only different edges of one nextOne lead to');
  ok(fork.errors.some((e) => e.rule === 2 && e.file === 'quests/o.jsonc' && /only one branch of f's options/.test(e.message)), 'rule 2: and after two only different options of one choice lead to');
  ok(fork.warnings.some((w) => w.file === 'quests/w.jsonc' && /different conditional edges of f/.test(w.message)) && !fork.errors.some((e) => e.rule === 2 && e.file === 'quests/w.jsonc'), 'two conditional edges might both hold, so after them it is a warning');
  ok(!fork.errors.some((e) => e.rule === 2 && e.file === 'quests/p.jsonc') && !fork.warnings.some((w) => w.file === 'quests/p.jsonc' && /wait/.test(w.message)), 'and a join after two steps every run goes on to is fine');
  const circle = check('own', [
    quest('ping', { repeat: { every: 'always' }, givers: [{ kind: 'debug' }, { kind: 'chain', after: 'pong' }], start: ['s'], steps: { s: { type: 'nothing', ends: 'done' } } }),
    quest('pong', { repeat: { every: 'always' }, givers: [{ kind: 'chain', after: 'ping' }], start: ['s'], steps: { s: { type: 'reward', reward: { credits: 1 }, ends: 'done' } } }),
    quest('slow', { repeat: { every: 'always' }, givers: [{ kind: 'debug' }, { kind: 'chain', after: 'slow' }], start: ['s'], steps: { s: { type: 'signal', signal: 'debug:slow', ends: 'done' } } }),
    quest('cool', { repeat: { every: 'cooldown', cooldown: { seconds: 60 } }, givers: [{ kind: 'debug' }, { kind: 'chain', after: 'cool' }], start: ['s'], steps: { s: { type: 'nothing', ends: 'done' } } }),
  ]);
  const circles = circle.errors.filter((e) => e.rule === 2 && /is a circle/.test(e.message));
  ok(circles.length === 1 && /own:ping -> own:pong -> own:ping/.test(circles[0].message), `rule 2: two quests repeated always, each finishing the moment it is given and giving the other, are a circle (${circles.map((e) => e.message).join('; ')})`);
  ok(!circle.errors.some((e) => /own:slow|own:cool/.test(e.message)), 'but one that waits on the player, or one with a cooldown, gives itself again only later, and is not');
}

// ---- the rest of the rules, each made to fire ----------------------------------------------------------------------
{
  const cat = { ids: new Set(['kreetle']), groups: new Set(['creatures/critter']), socials: new Set(['kreetle']), tags: new Set(['critter']) };
  const kills = check('own', [quest('k', { start: ['a', 'b', 'c'], steps: { a: { type: 'kill', social: 'gurk', n: 1, ends: 'done' }, b: { type: 'kill', group: 'creatures/nothing', n: 1, ends: 'done' }, c: { type: 'kill', tag: 'mythic', n: 1, ends: 'done' } } })], { catalogue: cat });
  ok(kills.warnings.some((w) => w.rule === 13 && /social group gurk/.test(w.message)) && kills.warnings.some((w) => w.rule === 13 && /group creatures\/nothing/.test(w.message)) && kills.warnings.some((w) => w.rule === 13 && /tag mythic/.test(w.message)), 'rule 13: a social group, a group or a tag no creature in the catalogue has is warned about');
  const trust = check('own', [
    quest('to', { start: ['a'], steps: { a: { type: 'signal', signal: 'debug:a', ends: 'done' } }, outcomes: { done: { do: ['trust(empire, 1)'] } } }),
    quest('tr', { repeat: { every: 'always' }, start: ['a'], steps: { a: { type: 'choice', options: [{ id: 'yes', label: 'TEST: yes', pressure: true, do: ['trust(empire, 1)'], ends: 'done' }] } } }),
  ]);
  ok(trust.errors.some((e) => e.rule === 5 && e.file === 'quests/to.jsonc' && /mark this outcome/.test(e.message)), 'rule 5: Trust on an outcome not under pressure is refused');
  ok(trust.errors.some((e) => e.rule === 5 && e.file === 'quests/tr.jsonc' && /repeatable quest may not move Trust/.test(e.message)), 'rule 5: and on an option of a repeatable quest, pressure or no');
  const charge = check('own', [
    quest('cs', { start: ['a'], steps: { a: { type: 'nothing', do: { done: ['charge(5)'] }, ends: 'done' } } }),
    quest('cg', { start: ['a'], steps: { a: { type: 'choice', options: [{ id: 'ok', label: 'TEST: ok', when: 'credits() > 49', do: ['charge(50)'], ends: 'done' }, { id: 'short', label: 'TEST: short', when: 'credits() > 48', do: ['charge(50)'], ends: 'done' }] } } }),
  ]);
  ok(charge.errors.some((e) => e.rule === 9 && e.file === 'quests/cs.jsonc'), 'rule 9: a charge on a plain step, with no choice to ask on, is refused');
  ok(charge.errors.filter((e) => e.rule === 9 && e.file === 'quests/cg.jsonc').length === 1 && has(charge, 9, /short charges 50/), 'rule 9: credits() > 49 asks enough for a charge of 50, and credits() > 48 does not');
  const places = check(
    'own',
    [
      quest('r', { start: ['a'], steps: { a: { type: 'goto', at: { world: 'tatooine', raw: [0, 0], room: { template: 'object/building/x.iff' } }, ends: 'done' } } }),
      quest('ws', { start: ['a'], steps: { a: { type: 'signal', signal: 'world:hoth', ends: 'done' } } }),
    ],
    {},
    [
      { path: 'areas/far.jsonc', text: JSON.stringify({ id: 'far', world: 'hoth', shape: { kind: 'circle', c: [0, 0], r: 5 } }) },
      { path: 'areas/roomless.jsonc', text: JSON.stringify({ id: 'roomless', world: 'tatooine', shape: { kind: 'circle', c: [0, 0], r: 5 }, room: { template: 'object/building/x.iff' } }) },
    ],
  );
  ok(places.errors.some((e) => e.rule === 7 && e.file === 'areas/far.jsonc' && /hoth is not a world/.test(e.message)), 'rule 7: an area on a world this game does not have is refused');
  ok(places.errors.some((e) => e.rule === 7 && e.file === 'quests/r.jsonc') && places.errors.some((e) => e.rule === 7 && e.file === 'areas/roomless.jsonc'), 'rule 7: a room that names no cell is refused, in a place and in an area');
  ok(places.errors.some((e) => e.rule === 7 && e.file === 'quests/ws.jsonc' && /hoth is not a world/.test(e.message)), 'rule 7: and so is a world: signal for a world the game does not have');
  const targets = check('own', [quest('t', { abandon: 'walkout', givers: [{ kind: 'chain', after: 'nope' }], start: ['a'], steps: { a: { type: 'signal', signal: 'debug:a', timeLimit: { seconds: 5 }, onFail: ['ghost'], ends: 'done' } } })]);
  ok(has(targets, 1, /fails into ghost/) && has(targets, 1, /own:nope is not a quest/) && has(targets, 1, /abandon names the outcome walkout/), 'rule 1: an onFail, a chain giver and an abandon naming nothing that is there are refused');
  const raisers = check(
    'own',
    [
      quest('lf', { start: ['a'], steps: { a: { type: 'signal', signal: 'left:area/yard', ends: 'done' } } }),
      quest('rm', { start: ['a'], steps: { a: { type: 'signal', signal: 'room:object/building/tatooine/shared_cantina_tatooine.iff#cantina', ends: 'done' } } }),
      quest('ow', { start: ['a'], steps: { a: { type: 'signal', signal: 'outword', ends: 'done' } } }),
      quest('os', { start: ['a'], steps: { a: { type: 'signal', signal: 'debug:x', ends: 'done' } }, outcomes: { done: { do: ['signal(outword)'] } } }),
    ],
    {},
    [{ path: 'areas/yard.jsonc', text: JSON.stringify({ id: 'yard', world: 'tatooine', shape: { kind: 'circle', c: [0, 0], r: 5 } }) }],
  );
  ok(!raisers.errors.some((e) => e.rule === 3 && /left:|room:|outword/.test(e.message)), 'rule 3: an area\'s left:, a room: and a signal an outcome raises all have their raiser');
}

// ---- a folder of story files, read off the disk -----------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'story-set-'));
  try {
    writeFileSync(join(dir, 'story.jsonc'), '{ "prefix": "own" }');
    writeFileSync(join(dir, '.hidden.jsonc'), '{}');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'config.json'), '{}');
    mkdirSync(join(dir, 'quests'));
    writeFileSync(join(dir, 'quests', 'big.jsonc'), Buffer.alloc(FILE_MAX + 1, 0x20));
    writeFileSync(join(dir, 'quests', 'notes.md'), '# not a story file');
    const r = readStorySet(dir);
    ok(r.files.length === 1 && r.files[0].path === 'story.jsonc', `a file or folder whose name starts with a dot is not read, nor a file of another kind (${r.files.map((f) => f.path).join(', ')})`);
    ok(r.refused.length === 1 && /quests\/big\.jsonc is larger than/.test(r.refused[0]), 'and a file larger than a story file can be is refused, by name, rather than read in part');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- npm run story:check ------------------------------------------------------------------------------
{
  const cli = join(ROOT, 'tools', 'story', 'check.mjs');
  const plain = spawnSync(process.execPath, [cli, TESTSET], { encoding: 'utf8', cwd: ROOT });
  ok(plain.status === 0 && /the test set .*: 18 quests.* 2 conversations .*3 cast members, 6 documents.* 0 errors/.test(plain.stdout),`the command line passes the test set (${plain.stdout.trim().split('\n').at(-1)})`);
  const dir = mkdtempSync(join(tmpdir(), 'story-check-'));
  try {
    mkdirSync(join(dir, 'quests'));
    writeFileSync(join(dir, 'story.jsonc'), '{ "prefix": "own", "title": "TEST" }');
    writeFileSync(join(dir, 'quests', 'bad.jsonc'), '{\n  "id": "bad",\n  "title": "TEST",\n  "start": ["a"],\n  "steps": {\n    "a": { "type": "signal", "signal": "nobody", "ends": "done" }\n  }\n}\n');
    const broken = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', cwd: ROOT });
    ok(broken.status === 1 && /quests\/bad\.jsonc:6: error: a waits on own:nobody, which nothing raises \(rule 3\)/.test(broken.stdout), `and fails a broken one, naming its file and line (${broken.stdout.split('\n').find((l) => /error/.test(l))})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // With no folder named: the owner's story-private beside the checkout first, then the test set.
  const root = mkdtempSync(join(tmpdir(), 'story-root-'));
  try {
    ok(defaultFolders(root).length === 1 && defaultFolders(root)[0] === join(root, 'src', 'story', 'testSet'), 'with no story-private beside the checkout, only the test set is checked');
    mkdirSync(join(root, 'story-private', 'quests'), { recursive: true });
    writeFileSync(join(root, 'story-private', 'story.jsonc'), '{ "prefix": "own", "title": "TEST" }');
    writeFileSync(join(root, 'story-private', 'quests', 'mine.jsonc'), '{\n  "id": "mine",\n  "title": "TEST",\n  "start": ["a"],\n  "steps": {\n    "a": { "type": "signal", "signal": "nobody", "ends": "done" }\n  }\n}\n');
    for (const f of files) {
      const to = join(root, 'src', 'story', 'testSet', ...f.path.split('/'));
      mkdirSync(join(to, '..'), { recursive: true });
      writeFileSync(to, f.text);
    }
    ok(defaultFolders(root).length === 2 && defaultFolders(root)[0] === join(root, 'story-private'), 'with one, it is checked before the test set');
    const run = spawnSync(process.execPath, [cli, `--root=${root}`], { encoding: 'utf8', cwd: ROOT });
    const lines = run.stdout.split('\n');
    const own = lines.findIndex((l) => /^story-private: the own set/.test(l));
    const test = lines.findIndex((l) => /^src\/story\/testSet: the test set/.test(l));
    ok(run.status === 1 && own >= 0 && test > own && lines.some((l) => /^story-private\/quests\/mine\.jsonc:6: error: .*nothing raises/.test(l)) && /0 errors/.test(lines[test]), `npm run story:check with no folder checks story-private and then the test set, and fails on story-private's error (${lines.filter((l) => /: the /.test(l)).join(' | ')})`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // A folder of the owner's that calls itself the test set gets none of the test set's allowances.
  const impostor = mkdtempSync(join(tmpdir(), 'story-impostor-'));
  try {
    mkdirSync(join(impostor, 'quests'));
    writeFileSync(join(impostor, 'story.jsonc'), '{ "prefix": "test", "title": "mine" }');
    writeFileSync(join(impostor, 'quests', 'rel.jsonc'), JSON.stringify({ id: 'rel', title: 'TEST', givers: [{ kind: 'debug' }], start: ['a'], steps: { a: { type: 'goto', at: { rel: 'start', dx: 1, dz: 1 }, next: ['b'] }, b: { type: 'signal', signal: 'debug:x', ends: 'done' } } }));
    const said: string[] = [];
    const errors = checkFolder(impostor, { worlds, catalogue: null, print: (l: string) => said.push(l) });
    ok(errors >= 1 && said.some((l) => /the prefix test is the committed test set's/.test(l)), `a folder that declares the prefix test is not read as the test set (${said.find((l) => /error/.test(l))})`);
  } finally {
    rmSync(impostor, { recursive: true, force: true });
  }
  ok(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['story:check'] === 'node tools/story/check.mjs', 'npm run story:check runs it');
  ok(readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).includes('story-private'), 'and the owner\'s own folder, story-private, is never committed');
  if (existsSync(join(ROOT, 'story-private'))) console.log('note: story-private/ is on this machine; the command checks it before the test set');
}

console.log(`\n${checks} checks passed`);
