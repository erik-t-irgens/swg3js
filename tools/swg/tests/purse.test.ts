// What a character has to spend: the server's half and the browser's, and the one rule both exist
// for -- a balance may not be spent twice, and a thing that was not paid for does not happen.
//
// Run: node tools/swg/tests/purse.test.ts

import assert from 'node:assert/strict';
import { PURSE_TUNING, Purses, applyPurse, credits, mayPurse } from '../../../server/purse.mjs';
import { applyChange, emptyWorld } from '../../../server/store.mjs';
import { Purse, creditText } from '../../../src/net/purse.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ---------------------------------------------------------------- an amount

{
  ok(credits(500) === 500 && credits(0) === 0, 'a whole number of credits is one');
  ok(credits(12.7) === 12, 'and a fraction is rounded down rather than refused, since a fare is never one');
  ok(credits(-1) === null, 'a debt is not an amount');
  ok(credits(PURSE_TUNING.most + 1) === null, 'nor is more than anybody may hold');
  ok(credits(Number.NaN) === null && credits('500' as unknown as number) === null && credits(undefined as unknown as number) === null, 'nor is anything that is not a number at all');
}

{
  const w = { at: 0, lines: 0 };
  let taken = 0;
  for (let i = 0; i < PURSE_TUNING.perSecond + 3; i++) if (mayPurse(w, 1000, PURSE_TUNING)) taken++;
  ok(taken === PURSE_TUNING.perSecond, 'a browser may send only so many purse words a second');
}

// ---------------------------------------------------------------- the server's half

const made = () => {
  const log: Record<string, unknown>[] = [];
  const p = new Purses({ tuning: PURSE_TUNING, write: (rec: Record<string, unknown>) => log.push(rec) });
  return { p, log };
};

{
  const { p, log } = made();
  ok(p.of('c1') === PURSE_TUNING.start, 'a character the world has never seen starts with the starting amount');
  ok(log.length === 1 && log[0].t === 'purse', 'and that is written down at once');
  ok(p.of('c1') === PURSE_TUNING.start && log.length === 1, 'asking again writes nothing: it is already a number this world knows');
}

{
  const { p, log } = made();
  const out = p.spend('c1', 1000, 7, 'the shuttle to Naboo');
  ok(out.ok && out.left === PURSE_TUNING.start - 1000, 'a fare comes out');
  ok(log.length === 2 && log[1].credits === PURSE_TUNING.start - 1000, 'and what is left is written down before anybody is told');
  const told = out.tell[0] as { msg: { credits: number; spent: number; what: string } };
  ok(told.msg.spent === 1000 && told.msg.what.includes('Naboo'), 'and the browser is told how much went and what for');
}

{
  const { p, log } = made();
  const before = log.length;
  const out = p.spend('c1', PURSE_TUNING.start + 1, 7, 'a palace');
  ok(!out.ok && out.why!.includes('a palace'), 'a fare that cannot be paid is refused by name');
  ok(p.of('c1') === PURSE_TUNING.start, 'and nothing at all comes out: there is no going as far as it can');
  ok(log.length === before + 1, 'and nothing is written but the opening of the purse itself');
}

{
  const { p } = made();
  p.spend('c1', PURSE_TUNING.start, 7, 'everything');
  ok(p.of('c1') === 0, 'a purse can be emptied');
  ok(!p.spend('c1', 1, 7, 'one more').ok, 'and then even one credit is refused');
  ok(p.give('c1', 500).left === 500, 'and money put in comes back');
}

{
  const { p } = made();
  ok(!p.spend('', 100, 7).ok, 'a browser with no character claimed has no purse to spend from');
  ok(!p.spend('c1', -5, 7).ok && !p.spend('c1', Number.NaN, 7).ok, 'and an amount that is not one moves nothing');
  ok(p.of('c1') === PURSE_TUNING.start, 'the purse is untouched by any of it');
}

{
  ok(p2Capped(), 'money put in never goes past the most anybody may hold');
}
function p2Capped(): boolean {
  const { p } = made();
  p.give('c1', PURSE_TUNING.most);
  return p.of('c1') === PURSE_TUNING.most;
}

// ---------------------------------------------------------------- it survives a restart

{
  const { p, log } = made();
  p.spend('c1', 4000, 7, 'a ride');
  p.give('c2', 100);
  const world = emptyWorld(1);
  for (const rec of log) ok(applyChange(world, rec) === true, `the store understands a ${rec.t} record`);
  const back = new Purses({ tuning: PURSE_TUNING });
  back.load(world);
  ok(back.of('c1') === PURSE_TUNING.start - 4000, 'what a character had is what it has after a restart');
  ok(back.of('c2') === PURSE_TUNING.start + 100, 'and so is what it was given');
}

{
  const world = emptyWorld(1);
  ok(applyPurse(world, { t: 'purse', id: '__proto__', credits: 1 }) === false, "a record naming one of the language's own names is refused");
  ok(applyPurse(world, { t: 'purse', id: 'c1', credits: -5 }) === false, 'and so is a debt');
  ok(applyPurse(world, { t: 'notThis', id: 'c1', credits: 5 }) === false, 'and a record from a newer server is not understood, which is not an error');
}

// ---------------------------------------------------------------- the browser's half

function browser(shared: boolean) {
  const sent: Record<string, unknown>[] = [];
  const said: string[] = [];
  let saved: number | null = null;
  const p = new Purse();
  p.attach({
    send: (m) => sent.push(m),
    say: (t) => said.push(t),
    shared: () => shared,
    saved: () => saved,
    save: (n) => (saved = n),
  });
  return { p, sent, said, get saved() { return saved; } };
}

{
  const b = browser(false);
  ok(b.p.credits > 0, 'with no server a character starts with something');
  ok(b.saved === b.p.credits, 'and it is written onto the character at once, so it is the same number next time');
  let went = false;
  b.p.spend(100, 'a local hop', () => (went = true));
  ok(went && b.p.credits === b.saved, 'a fare it can pay comes out and the journey happens');
  const had = b.p.credits;
  let far = false;
  b.p.spend(had + 1, 'a palace', () => (far = true));
  ok(!far && b.p.credits === had, 'one it cannot is refused, and the journey does not happen');
  ok(b.said.some((s) => s.includes('palace')), 'and it is said in words');
}

{
  // The rule the whole file is for: with a server, nothing on this side ever takes money off, and
  // the thing that was paid for happens only when the server says the money moved.
  const b = browser(true);
  let went = false;
  b.p.spend(1000, 'the shuttle', () => (went = true));
  ok(b.sent.length === 1 && b.sent[0].do === 'spend', 'a spend goes to the server as a question');
  ok(!went, 'and nothing happens while it waits');
  ok(b.saved === null, 'and nothing is written onto the character, because the server holds it');
  b.p.word({ t: 'purse', credits: 24000, spent: 1000, what: 'the shuttle' });
  ok(went, 'the answer is what makes the journey happen');
  ok(b.p.credits === 24000, "and the number is the server's, not one worked out here");
}

{
  const b = browser(true);
  let went = false;
  b.p.spend(1000, 'the shuttle', () => (went = true));
  b.p.word({ t: 'purse', why: 'the shuttle costs 1,000 and you have 40' });
  ok(!went, 'a refusal from the server leaves the journey undone');
  ok(b.said.length === 1 && b.p.report().waiting === null, 'says why, and nothing is left waiting to fire later');
  b.p.word({ t: 'purse', credits: 40, spent: 1000 });
  ok(!went, 'and a later word cannot set off the journey that was already refused');
}

{
  const b = browser(true);
  b.p.word({ t: 'purse', credits: 777 });
  ok(b.p.credits === 777 && b.p.known, 'the server saying what a character has is all it takes');
  b.p.reset();
  ok(!b.p.known, 'and a new character forgets it');
}

{
  const b = browser(false);
  b.p.spend(0, 'a free ride', () => {
    passed++;
    console.log('ok   a free ride costs nothing and happens at once');
  });
}

{
  ok(creditText(1234567).includes('1,234,567'), 'a number of credits reads with its thousands marked');
}

console.log(`\n${passed} checks passed`);
