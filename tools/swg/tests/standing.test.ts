// Standing and Trust on the three tracks, and the ranks a ladder hangs on them (`src/story/standing.ts`, moved
// by the step machine in `src/story/quests.ts`, shown by `src/story/view.ts`, said by `src/story/notes.ts`).
//
// What is pinned:
//
//   - `ladders.jsonc` is read -- the committed test set's TEST RUNGs and TEST words for Trust -- and every mistake
//     in one is named;
//   - Standing is ground out but only so fast (a repeatable job's daily cap), held between nought and its top,
//     and Trust between its two ends;
//   - a rung written `auto` is taken by itself the moment it is reached, and only once the track has taken the
//     character on; a rung the story promotes to waits on its beat (`rankReady`), which promotes;
//   - rank is held and can be lost: a demotion (with every job its rungs close), a suspension that runs out by
//     itself on the shared clock, a burn (no rank, no cell, the floor's Standing, Trust nought, what was burned
//     remembered) and only `activate` taking a burned track back; an assignment to a division;
//   - every rung held makes an entry in the ISB's file heavier;
//   - the player is shown a rank in words, a bar in steps and Trust in five words, never a number, and the
//     message line says a rank's change in words and Trust never;
//   - Trust moves only under pressure, a named person's own Trust through `npc()` included, and never in a
//     repeatable quest;
//   - a track's change is its whole record, so two books given the same batch hold the same track;
//   - only an active track takes an auto rung by itself: not one merely using the character, nor one suspended
//     or burned, whatever Standing it is given;
//   - a track's history is never longer than the book keeps of one, however the knob is turned.
//
// Synthetic, and the committed test set: nothing is read from the game's own files.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BOOK_LIMITS, applyChanges, cleanBook, cleanChange, cleanTrackRec, emptyBook, type StoryBook } from '../../../src/story/book.ts';
import { checkSet } from '../../../src/story/check.ts';
import { GAME_HOUR_MS } from '../../../src/story/clock.ts';
import { parseCondition } from '../../../src/story/expr.ts';
import { fileOf } from '../../../src/story/file.ts';
import { HostCore } from '../../../src/story/hostCore.ts';
import { noteWords } from '../../../src/story/notes.ts';
import { evalCond, type StoryNote } from '../../../src/story/quests.ts';
import { loadSet, type StorySet } from '../../../src/story/set.ts';
import { STANDING_TUNE, TRUST_WORDS, barToNext, burned, demoted, exposureOf, laddersOf, liftSuspension, statusOf, trackOf, trustBand, trustWords, tuneStanding, withHistory, withStatus, type LadderIssue } from '../../../src/story/standing.ts';
import { cleanView, viewOf } from '../../../src/story/view.ts';
import { readStorySet } from '../../../server/storySet.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const TESTSET = fileURLToPath(new URL('../../../src/story/testSet/', import.meta.url));
const testFiles = readStorySet(TESTSET).files.filter((f: { path: string }) => !f.path.startsWith('fixtures/'));
const lib = loadSet(testFiles, { test: true }).set;
let now = 1_900_000_000_000;
const ctx = (o: Record<string, unknown> = {}) => ({ now, world: 'tatooine', here: [3482, -4690] as [number, number], room: null, species: 'human_male', name: 'Han', credits: 100, ...o });
const cond = (src: string) => {
  const r = parseCondition(src);
  if ('error' in r) throw new Error(`${src}: ${r.error.message}`);
  return r.cond;
};
const holds = (book: StoryBook, src: string) => evalCond(cond(src), book, { ...ctx(), char: book.char, payer: 'browser' }, {}, undefined, lib);
const words = (notes: StoryNote[]) => notes.map((n) => noteWords(n, lib, { text: (t) => (typeof t === 'string' ? t : t.en) }) ?? '').filter(Boolean);

// ---- the ladders ------------------------------------------------------------------------------------------------
{
  const f = lib.ladders?.tracks.freelance;
  ok(!!f && f.floor === 5 && f.rungs.map((r) => `${r.id}:${r.name}:${r.promote}`).join() === 'f1:TEST RUNG 1:auto,f2:TEST RUNG 2:beat,f3:TEST RUNG 3:auto' && f.rungs[2].trust === 1, 'the test set\'s freelance ladder: a floor, a rung taken by itself, one the story promotes to, and one more taken by itself');
  ok(lib.ladders?.trustWords?.join() === 'TEST TRUST 1,TEST TRUST 2,TEST TRUST 3,TEST TRUST 4,TEST TRUST 5' && !!lib.ladders.tracks.rebellion && !!lib.ladders.tracks.empire, 'and five TEST words for Trust, and a ladder for each other track');
  const issues: LadderIssue[] = [];
  const read = laddersOf({ trustWords: ['a', 'b'], jedi: {}, empire: { floor: -1, rungs: [{ id: 'x', name: 'TEST X' }, { id: 'x', name: 'TEST Y' }, { id: 'y', name: 'TEST Z', promote: 'magic', standing: 'lots' }, { name: 'nameless' }, { id: 'z', name: 'TEST Q', standing: 5, closes: ['ok', 7] }] }, rebellion: { rungs: [{ id: 'hi', name: 'TEST HI', standing: 50 }, { id: 'lo', name: 'TEST LO', standing: 10 }] } }, 'own', issues);
  const says = (re: RegExp, level: 'error' | 'warning' = 'error') => issues.some((i) => i.level === level && re.test(i.message));
  ok(says(/trustWords is five words/) && says(/jedi is not a track/) && says(/a floor is Standing of nought/) && says(/x is the id of another rung/) && says(/taken by a "beat"/) && says(/standing is a number/) && says(/a rung is \{/) && says(/7 is not a quest id/) && says(/lo asks for less Standing than the rung below/, 'warning'), `every mistake in a ladders file is named (${issues.length})`);
  ok(read?.tracks.empire?.rungs.map((r) => r.id).join() === 'x,y,z' && read.tracks.empire.rungs[2].closes.join() === 'own:ok', 'what reads is kept, and a job a rung closes is prefixed with the set\'s own');
  ok(laddersOf([], 'own', []) === null, 'a ladders file that is not one object is not read');
}

// ---- grinding, auto rungs and the beat --------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-grind'), lib, payer: 'browser' });
  ok(!holds(h.book, 'rankReady(freelance)') && holds(h.book, 'trackIs(freelance, none)') && holds(h.book, 'rank(freelance) == "none"'), 'a track nobody has asked anything of: status none, no rank, nothing ready');
  const r1 = h.grant('test:grind', ctx());
  const t1 = trackOf(h.book, 'freelance');
  ok(t1.status === 'active' && t1.cell === 'test-cell' && t1.since === now && t1.standing === 20 && t1.rank === 'f1', `the first grind takes the character on, and TEST RUNG 1 is taken by itself the moment the track does (${JSON.stringify({ rank: t1.rank, standing: t1.standing, status: t1.status })})`);
  const said1 = words(r1.notes);
  ok(said1.includes('Freelance: taken on') && said1.includes('Freelance: promoted to TEST RUNG 1') && said1.includes('Freelance standing rose') && !said1.some((w) => /\d/.test(w.replace(/TEST RUNG \d/, ''))), `the message line says the track took them on, the rank in words and which way Standing went, never a number (${said1.join(' | ')})`);
  h.sweep(ctx());
  h.grant('test:grind', ctx());
  ok(trackOf(h.book, 'freelance').standing === 40, 'the second grind gives its 20');
  const r3 = h.grant('test:grind', ctx());
  ok(trackOf(h.book, 'freelance').standing === 40 && !words(r3.notes).some((w) => /Freelance standing/.test(w)), 'the third in a real day gives nothing: Standing is ground out, but only 40 a day of this job, and nothing is said of nothing');
  ok(holds(h.book, 'rankReady(freelance)') && !holds(h.book, 'rankAtLeast(freelance, f2)') && holds(h.book, 'rankAtLeast(freelance, f1)'), 'past TEST RUNG 2\'s Standing, the rung waits on the story\'s beat rather than being taken');
  const beat = h.grant('test:standing', ctx());
  ok(trackOf(h.book, 'freelance').rank === 'f2' && words(beat.notes).includes('Freelance: promoted to TEST RUNG 2') && !holds(h.book, 'rankReady(freelance)'), 'the beat promotes to it, says so in words, and nothing more is ready');
  ok(h.grant('test:standing', ctx()).why !== null, 'and the beat is not given twice');
  // TEST RUNG 3 asks a point of Trust as well as 60 Standing: Standing alone does not take it.
  h.setTrack('freelance', { standing: 60 }, ctx());
  ok(trackOf(h.book, 'freelance').rank === 'f2', 'the console sets Standing outright, and a rung that also asks for Trust is not taken on Standing alone');
  const pressed = h.run(['trust(freelance, 1)'], ctx());
  ok(trackOf(h.book, 'freelance').trust === 1 && trackOf(h.book, 'freelance').rank === 'f3' && !words(pressed.notes).some((w) => /trust/i.test(w)) && words(pressed.notes).includes('Freelance: promoted to TEST RUNG 3'), 'a point of Trust takes TEST RUNG 3 by itself; the rank is said, the Trust never');
  ok(h.book.tracks?.freelance?.history?.some((x) => x.what === 'promote' && x.to === 'f3') === true, 'every change is in the track\'s own history');
}
{
  // An auto rung is not taken by a track that has not taken the character on.
  const h = new HostCore({ book: emptyBook('c-stranger'), lib, payer: 'browser' });
  h.run(['standing(rebellion, 50)'], ctx());
  ok(trackOf(h.book, 'rebellion').rank === undefined && trackOf(h.book, 'rebellion').standing === 50 && !holds(h.book, 'rankReady(rebellion)'), 'Standing done for a track that never took the character on takes no rung, auto or not');
  h.run(['activate(rebellion)'], ctx());
  ok(trackOf(h.book, 'rebellion').rank === 'r1' && holds(h.book, 'rankReady(rebellion)'), 'taken on, the auto rung is taken at once, and the next waits on its beat');
  h.run(['useTrack(rebellion)'], ctx());
  ok(trackOf(h.book, 'rebellion').status === 'active', 'a track that has taken the character on is never set back to merely using them');
}
{
  // Only an active track takes an auto rung by itself: one that merely uses the character does not, and nor does
  // one suspended, however much Standing either is given.
  const used = new HostCore({ book: emptyBook('c-used'), lib, payer: 'browser' });
  used.run(['useTrack(freelance)'], ctx());
  now += 1;
  used.run(['standing(freelance, 50)'], ctx());
  ok(trackOf(used.book, 'freelance').status === 'used' && trackOf(used.book, 'freelance').standing === 50 && trackOf(used.book, 'freelance').rank === undefined, 'a track that only uses the character takes no rung, auto or not');
  const sus = new HostCore({ book: emptyBook('c-sus'), lib, payer: 'browser' });
  sus.run(['activate(freelance)'], ctx());
  ok(trackOf(sus.book, 'freelance').rank === 'f1', 'taken on, the first auto rung is taken at once');
  now += 1;
  sus.run(['demote(freelance)', 'suspend(freelance, 1)'], ctx());
  now += 1;
  sus.run(['standing(freelance, 50)'], ctx());
  ok(holds(sus.book, 'trackIs(freelance, suspended)') && trackOf(sus.book, 'freelance').standing === 50 && trackOf(sus.book, 'freelance').rank === null, `suspended, it takes no rung on Standing either (${JSON.stringify({ rank: trackOf(sus.book, 'freelance').rank, standing: trackOf(sus.book, 'freelance').standing })})`);
}

// ---- clamped -------------------------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-clamp'), lib, payer: 'browser' });
  h.run(['standing(empire, 99999)', 'trust(empire, 99)'], ctx());
  ok(trackOf(h.book, 'empire').standing === STANDING_TUNE.standingMax && trackOf(h.book, 'empire').trust === STANDING_TUNE.trustMax, 'Standing stops at its top and Trust at its');
  now += 1;
  h.run(['standing(empire, -99999)', 'trust(empire, -99)'], ctx());
  ok(trackOf(h.book, 'empire').standing === 0 && trackOf(h.book, 'empire').trust === STANDING_TUNE.trustMin, 'and at nought and Trust\'s bottom going down');
}

// ---- losing a rank -----------------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-lose'), lib, payer: 'browser' });
  h.run(['activate(freelance, test-cell)', 'standing(freelance, 30)', 'promote(freelance)'], ctx());
  ok(trackOf(h.book, 'freelance').rank === 'f2', 'a character at TEST RUNG 2');
  const down = h.run(['demote(freelance)'], ctx());
  ok(trackOf(h.book, 'freelance').rank === 'f1' && words(down.notes).includes('Freelance: demoted to TEST RUNG 1'), 'demoted a rung, and told in words');
  h.run(['demote(freelance, 5)'], ctx());
  ok(trackOf(h.book, 'freelance').rank === null && holds(h.book, 'rank(freelance) == "none"'), 'demoted past the bottom, no rank at all');
  ok(h.run(['demote(freelance)'], ctx()).why === 'there is no rank to take', 'and with no rank there is nothing to take');
  // Suspended for a game hour: lifted by the sweep once the hour is up, stamped with when it ran out.
  h.run(['promote(freelance)'], ctx());
  const sus = h.run(['suspend(freelance, 1)'], ctx());
  ok(holds(h.book, 'trackIs(freelance, suspended)') && words(sus.notes).includes('Freelance: suspended') && trackOf(h.book, 'freelance').suspendedUntil === now + GAME_HOUR_MS, 'suspended for one game hour');
  const t0 = now;
  now += GAME_HOUR_MS - 1;
  h.sweep(ctx());
  ok(holds(h.book, 'trackIs(freelance, suspended)'), 'still suspended a moment before the hour is up');
  now += 2;
  const back = h.sweep(ctx());
  ok(holds(h.book, 'trackIs(freelance, active)') && words(back.notes).includes('Freelance: your suspension is over') && trackOf(h.book, 'freelance').since === t0 + GAME_HOUR_MS, 'and back to what it was the moment the hour runs out, stamped then');
  // Burned: no rank and no cell, the floor's Standing, Trust nought, and what was burned remembered.
  h.run(['standing(freelance, 100)', 'trust(freelance, 2)'], ctx());
  const burn = h.run(['burn(freelance)'], ctx());
  const b = trackOf(h.book, 'freelance');
  ok(b.status === 'burned' && b.rank === null && b.cell === null && b.standing === 5 && b.trust === 0 && b.burnedFrom === 'test-cell' && words(burn.notes).includes('Freelance: you are burned'), `burned: no rank, no cell, the ladder's floor of Standing, Trust nought, the cell remembered (${JSON.stringify(b)})`);
  // A moment on, or the console's payment key for this call is the one the call before it already paid.
  now += 1;
  h.run(['useTrack(freelance)', 'standing(freelance, 50)'], ctx());
  ok(trackOf(h.book, 'freelance').status === 'burned' && trackOf(h.book, 'freelance').standing === 55 && trackOf(h.book, 'freelance').rank === null, `a burned track does not merely use the character again, nor take a rung on the Standing it is given (${trackOf(h.book, 'freelance').standing})`);
  h.run(['activate(freelance, new-cell)'], ctx());
  ok(trackOf(h.book, 'freelance').status === 'active' && trackOf(h.book, 'freelance').cell === 'new-cell' && trackOf(h.book, 'freelance').burnedFrom === 'test-cell' && trackOf(h.book, 'freelance').rank === 'f1', 'only activate takes it back: a new cell, what was burned still remembered, and the auto rungs its Standing reaches taken again (the rung a beat promotes to waits for it)');
  // A division.
  const as = h.run(['assign(empire, surveillance)'], ctx());
  ok(holds(h.book, 'division(empire) == "surveillance"') && !holds(h.book, 'division(empire) == "enforcement"') && words(as.notes).includes('Empire: assigned to surveillance'), 'assigned to a division, read by a condition, said in words');
}
{
  // A demotion closes what its rungs close: an in-memory ladder, since the test set's rungs close nothing.
  const own = loadSet([
    { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' },
    { path: 'ladders.jsonc', text: '{ "empire": { "rungs": [ { "id": "a", "name": "TEST A" }, { "id": "b", "name": "TEST B", "standing": 10, "closes": ["perk"] } ] } }' },
    { path: 'quests/perk.jsonc', text: '{ "id": "perk", "title": "TEST PERK", "givers": [{ "kind": "debug" }], "start": ["s"], "steps": { "s": { "type": "signal", "signal": "debug:p", "ends": "done" } } }' },
  ]).set;
  const h = new HostCore({ book: emptyBook('c-close'), lib: own, payer: 'browser' });
  h.run(['activate(empire)', 'promote(empire)', 'promote(empire)'], ctx());
  ok(trackOf(h.book, 'empire').rank === 'b', 'promoted twice, to the second rung');
  h.run(['demote(empire)'], ctx());
  ok(h.book.closed?.includes('own:perk') === true && h.grant('own:perk', ctx()).why === 'that job is closed', 'demoted off it, the job the rung closes is closed for good');
  const d = demoted({ standing: 0, trust: 0, rank: 'b' }, own.ladders!.tracks.empire!, 9, now);
  ok(d?.rec.rank === null && d.closes.join() === 'own:perk', 'demoted past every rung, every rung left behind closes what it closes');
}

// ---- exposure ----------------------------------------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-exposure'), lib, payer: 'browser' });
  ok(exposureOf(h.book, lib.ladders) === 1, 'no rung held, no extra exposure');
  h.run(['activate(freelance)', 'standing(freelance, 30)', 'promote(freelance)', 'activate(empire)'], ctx());
  ok(exposureOf(h.book, lib.ladders) === 1.5 * 2, `TEST RUNG 2 (1.5) and the Empire's TEST RUNG 1 (2), multiplied (${exposureOf(h.book, lib.ladders)})`);
  h.run(['file(isb, incident, 4)'], ctx());
  const e = fileOf(h.book, 'isb')!.entries[0];
  ok(e.mult === 3 && fileOf(h.book, 'isb')!.exposure === 12, 'an entry written then weighs its weight times every rung held, frozen as it was written');
}

// ---- what the player is shown -------------------------------------------------------------------------------------
{
  ok(trustBand(-9) === 0 && trustBand(-3) === 1 && trustBand(0) === 2 && trustBand(3) === 3 && trustBand(6) === 4 && trustBand(99) === 4, 'Trust\'s five bands are cut at -3, 0, 3 and 6');
  ok(trustWords(0, lib.ladders) === 'TEST TRUST 3' && trustWords(0, null) === TRUST_WORDS[2], 'shown in the story\'s own words, or ours with none');
  const ladder = lib.ladders!.tracks.freelance!;
  ok(barToNext({ standing: 0, trust: 0, rank: 'f1' }, ladder) === 0 && barToNext({ standing: 15, trust: 0, rank: 'f1' }, ladder) === 0.5 && barToNext({ standing: 29.9, trust: 0, rank: 'f1' }, ladder) === 0.98 && barToNext({ standing: 99, trust: 9, rank: 'f3' }, ladder) === null, 'the bar runs from the rung held to the next in steps of a fiftieth, and there is none at the top');
  const h = new HostCore({ book: emptyBook('c-view'), lib, payer: 'browser' });
  h.run(['activate(freelance, test-cell)', 'standing(freelance, 15)', 'trust(freelance, 4)', 'activate(rebellion)', 'burn(rebellion)', 'xp(7)'], ctx());
  const v = viewOf(h.book, lib, { ...ctx(), char: 'c-view', payer: 'browser' });
  const f = v.standing?.tracks.find((t) => t.track === 'freelance');
  const reb = v.standing?.tracks.find((t) => t.track === 'rebellion');
  ok(!!f && f.rank === 'TEST RUNG 1' && f.next === 'TEST RUNG 2' && f.bar === 0.5 && f.trust === 'TEST TRUST 4' && f.status === 'active' && f.cell === 'test-cell' && !f.ready, `the Standing tab: the rank in words, the next, a bar, Trust in words (${JSON.stringify(f)})`);
  ok(reb?.status === 'burned' && reb.rank === null && reb.burnedFrom === 'TEST RUNG 1' && v.standing?.xp === 7, 'a burned track says so, with what it took by name, and experience is carried');
  const json = JSON.stringify(v.standing);
  ok(!/"standing"|"trust":\s*-?\d|"history"/.test(json), `and never a number of Standing or Trust, nor the history (${json.slice(0, 160)})`);
  const back = cleanView(JSON.parse(JSON.stringify(v)));
  ok(JSON.stringify(back?.standing) === json, 'a view off the wire keeps the tracks exactly');
}

// ---- trust only under pressure --------------------------------------------------------------------------------
{
  const quest = (id: string, body: Record<string, unknown>) => ({ path: `quests/${id}.jsonc`, text: JSON.stringify({ id, title: 'TEST', givers: [{ kind: 'debug' }], start: ['s'], ...body }) });
  const r = checkSet(
    loadSet([
      { path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' },
      { path: 'cast/v.jsonc', text: '{ "id": "v", "name": "TEST V", "body": "x", "world": "tatooine", "at": [0, 0] }' },
      quest('plain', { steps: { s: { type: 'nothing', do: { done: ['npc(cast/v, 0, 1)'] }, ends: 'done' } } }),
      quest('fine', { steps: { s: { type: 'nothing', do: { done: ['npc(cast/v, 5, 0)'] }, ends: 'done' } } }),
      quest('picked', { steps: { s: { type: 'choice', options: [{ id: 'a', pressure: true, do: ['npc(cast/v, 0, 2)'], ends: 'done' }, { id: 'b', do: ['npc(cast/v, 1, -1)'], ends: 'done' }] } } }),
      quest('again', { repeat: { every: 'always' }, steps: { s: { type: 'choice', options: [{ id: 'a', pressure: true, do: ['npc(cast/v, 0, 1)'], ends: 'done' }] } } }),
      { path: 'talk/t.jsonc', text: JSON.stringify({ format: 1, id: 't', speaker: 'cast/v', entry: [{ to: 'n' }], nodes: { n: { say: ['TEST'], do: ['npc(cast/v, 0, 1)'], replies: [{ id: 'p', text: 'TEST', pressure: true, do: ['choose(own:picked, s, a)', 'choose(own:again, s, a)'] }] } } }) },
    ]),
  );
  const rule5 = (file: string) => r.errors.filter((e) => e.rule === 5 && e.file === file);
  ok(rule5('quests/plain.jsonc').length === 1 && rule5('quests/fine.jsonc').length === 0, 'a named person\'s own Trust moved in a plain step is refused; their Standing alone is not');
  ok(rule5('quests/picked.jsonc').length === 1 && /option b moves Trust/.test(rule5('quests/picked.jsonc')[0].message), 'on an option it moves only under pressure');
  ok(rule5('quests/again.jsonc').some((e) => /repeatable/.test(e.message)) && rule5('talk/t.jsonc').length === 1, 'never in a repeatable quest, and never as a conversation\'s node is reached');
  const rank = checkSet(loadSet([{ path: 'story.jsonc', text: '{ "prefix": "own", "title": "TEST" }' }, { path: 'ladders.jsonc', text: '{ "rebellion": { "rungs": [{ "id": "r1", "name": "TEST R1" }] } }' }, quest('r', { needs: 'rankAtLeast(rebellion, r9) || rank(rebellion) == "r1"', steps: { s: { type: 'nothing', ends: 'done' } } })]));
  ok(rank.errors.some((e) => e.rule === 1 && /no rung r9/.test(e.message)) && !rank.errors.some((e) => /no rung r1/.test(e.message)), 'a rung a condition names is on its ladder, or the checker says so');
}

// ---- a track's change is its whole record ------------------------------------------------------------------
{
  const h = new HostCore({ book: emptyBook('c-whole'), lib, payer: 'browser' });
  const copy = cleanBook(JSON.parse(JSON.stringify(h.book)))!;
  const r = h.run(['activate(freelance, test-cell)', 'standing(freelance, 30)', 'promote(freelance)', 'suspend(freelance, 2)'], ctx());
  ok(r.ch.filter((c) => c.k === 'trackSet').length >= 4 && r.ch.every((c) => c.k !== 'trackAdd'), 'every move of a track is written as its whole record, never arithmetic on it');
  applyChanges(copy, JSON.parse(JSON.stringify(r.ch)));
  ok(JSON.stringify(copy.tracks) === JSON.stringify(h.book.tracks), 'so another copy of the book given the same batch holds the very same track');
  // The rules clamp; applying stores. A tune moved on one host changes nothing about applying the other's batch.
  const before = { ...STANDING_TUNE };
  tuneStanding({ standingMax: 10 });
  const again = cleanBook(JSON.parse(JSON.stringify(copy)))!;
  applyChanges(again, [{ k: 'trackSet', track: 'freelance', rec: { ...trackOf(copy, 'freelance'), standing: 500 } }]);
  ok(trackOf(again, 'freelance').standing === 500, 'a batch another host worked out is stored as it came, whatever this host\'s own tune says');
  tuneStanding(before);
  ok(cleanChange({ k: 'trackSet', track: 'jedi', rec: { standing: 1, trust: 0 } }) === null && cleanChange({ k: 'trackSet', track: 'empire', rec: 'x' }) === null && cleanTrackRec({ standing: 'a', status: 'royal', division: 'cooks', rank: 'r 1' })?.status === undefined, 'a track that is not one, a record that is not one, and fields that are not theirs are refused or dropped');
  ok(statusOf({ standing: 0, trust: 0, status: 'suspended', suspendedUntil: 10, history: [{ at: 1, what: 'suspend', from: 'used', to: 'suspended' }] }, 11) === 'used' && liftSuspension({ standing: 0, trust: 0, status: 'suspended', suspendedUntil: 10 }, 9) === null, 'a suspension run out reads as the status it took the track from, and one still running is not lifted');
  ok(withStatus({ standing: 0, trust: 0, status: 'active' }, 'active', 1) === null && burned({ standing: 9, trust: 3, rank: 'f2' }, lib.ladders!.tracks.freelance!, 1).burnedFrom === 'f2', 'nothing to change is no change, and a burn with no cell remembers the rank');
}

// ---- a history never longer than the book keeps ------------------------------------------------------------------
{
  // The knob may be turned up, but never past what the book takes of one track: a history longer than that is
  // refused, and the track would then take no move ever again.
  const before = { ...STANDING_TUNE };
  tuneStanding({ historyMax: 100 });
  ok(STANDING_TUNE.historyMax === BOOK_LIMITS.trackHistory, `historyMax is held to the book's own ${BOOK_LIMITS.trackHistory} lines`);
  const long = withHistory({ standing: 0, trust: 0, history: Array.from({ length: 80 }, (_, i) => ({ at: i, what: 'x', from: null, to: null })) }, 99, 'y', null, null, 500);
  ok(long.history?.length === BOOK_LIMITS.trackHistory && long.history.at(-1)?.at === 99, 'and a history asked to keep more is still cut to it, the newest kept');
  const h = new HostCore({ book: emptyBook('c-history'), lib, payer: 'browser' });
  for (let i = 0; i < 70; i++) {
    now += 1;
    h.run([i % 2 ? 'suspend(freelance, 1)' : 'activate(freelance)'], ctx());
  }
  now += 1;
  const burn = h.run(['burn(freelance)'], ctx());
  ok(burn.why === null && trackOf(h.book, 'freelance').status === 'burned' && (trackOf(h.book, 'freelance').history?.length ?? 0) <= BOOK_LIMITS.trackHistory, `seventy moves on, the track still takes the next (${burn.why ?? 'taken'})`);
  tuneStanding(before);
}

console.log(`\nstanding: ${checks} checks passed`);
