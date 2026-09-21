// The world's creatures as they cross between browsers: what the relay keeps of a keeper's batch, a
// blow asked of a keeper and the word that one has gone (server/npcWire.mjs), then the browser's own
// half of the same thing (src/net/npcNet.ts) -- who is driven and who is kept, that a blow is never
// applied to something this browser does not keep, that a death happens once and stays, and that a
// keeper holding more creatures than one batch carries says something about every one of them.
//
// Synthetic messages and a stand-in creature only: nothing here builds a world, and the stand-in is
// the `NpcSubject` interface and nothing else, which is the whole point of that interface.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NPC_WIRE, NpcPlaces, cleanNpcBatch, cleanNpcDrop, cleanNpcGone, cleanNpcHit, cleanNpcRow, npcId } from '../../../server/npcWire.mjs';
import { NPC_TUNE, NpcNet, type NpcRow, type NpcSubject } from '../../../src/net/npcNet.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const row = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ i: 'w:1:7', p: [1, 2, 3], h: 0.5, s: 'wander', v: 1.25, hp: 0.5, ...extra });

// --- 1: one creature's row ------------------------------------------------------------------------
{
  const clean = cleanNpcRow(row());
  ok(!!clean && clean.i === 'w:1:7' && clean.p[2] === 3 && clean.h === 0.5 && clean.s === 'wander' && clean.v === 1.25 && clean.hp === 0.5, `1: the id, the place, the heading, the state, the pace and the health are kept (${JSON.stringify(clean)})`);
  ok(cleanNpcRow(row({ f: 'hit' }))?.f === 'hit' && cleanNpcRow(row({ f: 'leap' }))?.f === 'leap', '1: the two things that must be seen once are kept');
  ok(cleanNpcRow(row({ f: 'explode' }))?.f === undefined, '1: a mark nobody knows is dropped');
  // A death is not a mark: it has a word of its own that the server carries to everybody, a row is
  // never sent for a creature that is already dead, and the vocabulary says only what it can mean.
  ok(cleanNpcRow(row({ f: 'die' }))?.f === undefined, '1: a death is not one of them: it is its own word and not a mark on a row');
  ok(cleanNpcRow(row({ s: 'plotting' }))?.s === 'idle', '1: a state nobody knows stands idle rather than choosing a clip that is not there');
  ok(cleanNpcRow(row({ hp: 4 }))?.hp === 1 && cleanNpcRow(row({ hp: -2 }))?.hp === 0, '1: health is a share of the whole and cannot be more than all of it or less than none');
  ok(cleanNpcRow(row({ v: 1e9 }))?.v === NPC_WIRE.speed, '1: a pace faster than anything walks is cut to the cap');
  ok(cleanNpcRow(row({ v: 'fast' }))?.v === 0, '1: a pace that is not a number stands still');
  const junk = cleanNpcRow(row({ owner: 3, brain: { target: 1 } })) as Record<string, unknown>;
  ok(Object.keys(junk).join() === 'i,p,h,s,v,hp', `1: fields nobody knows are dropped (${Object.keys(junk).join()})`);
}

// --- 2: what is not a row -------------------------------------------------------------------------
{
  ok(cleanNpcRow(null) === undefined && cleanNpcRow(undefined) === undefined && cleanNpcRow([1, 2]) === undefined, '2: nothing, and a list, are not a row');
  ok(cleanNpcRow(row({ i: '' })) === undefined && cleanNpcRow(row({ i: 5 })) === undefined, '2: a row with no id is dropped');
  ok(cleanNpcRow(row({ i: '<script>' })) === undefined, '2: an id that is not a name is dropped');
  ok(cleanNpcRow(row({ i: 'x'.repeat(NPC_WIRE.id + 1) })) === undefined, '2: an over-long id is dropped');
  ok(cleanNpcRow(row({ p: [1, 2] })) === undefined && cleanNpcRow(row({ p: [1, 2, Number.NaN] })) === undefined, '2: a place that is not three numbers is dropped');
  ok(cleanNpcRow(row({ p: [1, 2, 1e12] })) === undefined, '2: a place outside the world is dropped');
  ok(npcId('a.b-c:d_1') === 'a.b-c:d_1' && npcId('a/b') === '' && npcId(7) === '', '2: an id is letters, digits and the few separators a made id uses');
}

// --- 3: the batch ---------------------------------------------------------------------------------
{
  const many = { r: Array.from({ length: NPC_WIRE.rows + 20 }, (_, n) => row({ i: `w:1:${n}` })) };
  const clean = cleanNpcBatch(many);
  ok(clean?.r.length === NPC_WIRE.rows, `3: a batch carries at most ${NPC_WIRE.rows} rows (${clean?.r.length})`);
  const mixed = cleanNpcBatch({ r: [row(), null, row({ i: '' }), row({ i: 'w:1:9' })] });
  ok(mixed?.r.length === 2 && mixed.r[1].i === 'w:1:9', '3: rubbish rows are dropped and the rest passed on');
  ok(cleanNpcBatch({ r: [] }) === undefined && cleanNpcBatch({ r: [null] }) === undefined, '3: a batch with nothing left in it is not a message');
  ok(cleanNpcBatch({ r: 'all of them' }) === undefined && cleanNpcBatch(null) === undefined, '3: a batch whose rows are not a list is dropped');
}

// --- 4: a blow asked of a keeper, and a creature gone ---------------------------------------------
{
  const hit = cleanNpcHit({ i: 'w:1:7', a: 12.5, at: [1, 2, 3], w: 'blaster' });
  ok(!!hit && hit.i === 'w:1:7' && hit.a === 12.5 && hit.at[1] === 2 && hit.w === 'blaster', `4: a blow keeps which creature, how much, where and what struck (${JSON.stringify(hit)})`);
  ok(cleanNpcHit({ i: 'w:1:7', a: 0 }) === undefined && cleanNpcHit({ i: 'w:1:7', a: -5 }) === undefined, '4: a blow that takes nothing is not a message');
  ok(cleanNpcHit({ i: 'w:1:7', a: 1e12 })?.a === NPC_WIRE.damage, '4: a blow past the cap is cut to it rather than refused');
  ok(cleanNpcHit({ i: 'w:1:7', a: 5 })?.at.join() === '0,0,0', '4: a blow with no place is still a blow');
  ok(cleanNpcHit({ a: 5 }) === undefined, '4: a blow naming no creature is dropped');
  ok(cleanNpcHit({ i: 'w:1:7', a: 5, w: 'a\u0000b' })?.w === 'ab', '4: control characters are taken out of the word for what struck');
  ok(cleanNpcGone({ i: 'w:1:7', why: 'dead' })?.why === 'dead' && cleanNpcGone({ i: 'w:1:7', why: 'gone' })?.why === 'gone', '4: a creature is dead or taken away');
  ok(cleanNpcGone({ i: 'w:1:7', why: 'asleep' })?.why === 'gone' && cleanNpcGone({ why: 'dead' }) === undefined, '4: a reason nobody knows is "taken away", and no id at all is no message');
  // Who struck crosses as one flag and never as a name: the only person one browser can point at on
  // another is that browser's own player, and a creature or a turret of theirs is nobody nameable.
  ok(cleanNpcHit({ i: 'w:1:7', a: 5, b: 1 })?.b === 1, '4: a blow the player struck themselves says so');
  ok(cleanNpcHit({ i: 'w:1:7', a: 5 })?.b === undefined && cleanNpcHit({ i: 'w:1:7', a: 5, b: 0 })?.b === undefined, '4: and one struck by anything else blames nobody');
  ok(cleanNpcHit({ i: 'w:1:7', a: 5, b: 'the player' })?.b === 1, '4: whatever shape that flag arrives in, it is a flag');
  // A browser handing back a grant it cannot honour: the word carries the id and nothing else.
  ok(cleanNpcDrop({ i: 'w:1:7' })?.i === 'w:1:7', '4: a browser can say it cannot keep one');
  ok(cleanNpcDrop({ i: '<script>' }) === undefined && cleanNpcDrop({}) === undefined && cleanNpcDrop(null) === undefined, '4: and that word is nothing without a real id');
  ok(Object.keys(cleanNpcDrop({ i: 'w:1:7', why: 'because', keeper: 3 }) as object).join() === 'i', '4: it asks for nothing else, so it carries nothing else');
}

// --- 4b: the file itself --------------------------------------------------------------------------
{
  // The one module that checks everything coming off the wire must stay a text file. A raw NUL in a
  // character class makes it binary to git -- no diff and no blame -- and an editor save, a lint
  // autofix or an encoding pass can then change what the class matches without showing a change.
  // So the class is written as escapes, and this is what says it stayed that way.
  const source = readFileSync(new URL('../../../server/npcWire.mjs', import.meta.url), 'utf8');
  const control = [...source].filter((ch) => {
    const code = ch.charCodeAt(0);
    return (code < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t') || code === 127;
  });
  ok(control.length === 0, `4b: the wire's own module holds no control character of its own (${control.length})`);
  ok(/const CONTROL = \/\[\\u0000-\\u001f\\u007f\]\/g;/.test(source), '4b: and the class it strips them with is written as escapes');
}

// --- 5: the places the server remembers -----------------------------------------------------------
{
  const places = new NpcPlaces({ remember: 3 });
  places.note('tatooine', [cleanNpcRow(row({ i: 'a', f: 'hit' }))!, cleanNpcRow(row({ i: 'b' }))!]);
  ok(places.rows('tatooine').length === 2, '5: what a keeper said is remembered for the world it was said on');
  ok(places.rows('tatooine').every((r: { f?: string }) => r.f === undefined), '5: a mark is not remembered, or a newcomer would be told about a blow struck before they arrived');
  places.note('tatooine', [cleanNpcRow(row({ i: 'a', p: [9, 9, 9] }))!]);
  ok(places.rows('tatooine').find((r: { i: string }) => r.i === 'a')?.p[0] === 9, '5: a creature spoken about again is where it was said to be last');
  ok(places.rows('tatooine').length === 2, '5: and is not remembered twice');
  places.note('tatooine', [cleanNpcRow(row({ i: 'c' }))!, cleanNpcRow(row({ i: 'd' }))!]);
  ok(places.rows('tatooine').length === 3 && places.describe().dropped === 1, '5: one world holds as many as it may and the rest are dropped and counted');
  places.gone('tatooine', 'a');
  ok(places.rows('tatooine').length === 2, '5: a creature that died or was taken away is no longer anywhere');
  ok(places.rows('naboo').length === 0, '5: a world nothing has been said about has nothing to say');
  places.forget('tatooine');
  ok(places.rows('tatooine').length === 0 && places.describe().worlds === 0, '5: a world nobody is left on is forgotten');
}

// ---------------------------------------------------------------------------------------------------
// The browser's half.

/** A creature as `npcNet.ts` sees one: the interface and nothing else. */
class Stand implements NpcSubject {
  readonly npcId: string;
  npcDead = false;
  ready = true;
  at: [number, number, number] = [0, 0, 0];
  heading = 0;
  state = 'idle';
  speed = 0;
  health = 1;
  mark: string | undefined;
  driven = false;
  /** What it has been told and what it has been done to, for the checks. */
  drives: { row: NpcRow; snap: boolean }[] = [];
  hurts: { amount: number; by: unknown }[] = [];
  ends: string[] = [];
  drivenCalls = 0;
  filled = 0;

  constructor(id: string) {
    this.npcId = id;
  }

  npcFill(row: NpcRow): boolean {
    if (!this.ready) return false;
    this.filled++;
    row.p[0] = this.at[0];
    row.p[1] = this.at[1];
    row.p[2] = this.at[2];
    row.h = this.heading;
    row.s = this.state;
    row.v = this.speed;
    row.hp = this.health;
    if (this.mark) row.f = this.mark as NpcRow['f'];
    this.mark = undefined;
    return true;
  }

  npcDrive(row: NpcRow, snap: boolean): void {
    this.drives.push({ row: { ...row, p: [...row.p] }, snap });
    this.at = [row.p[0], row.p[1], row.p[2]];
    this.health = row.hp;
  }

  npcSetDriven(driven: boolean): void {
    this.driven = driven;
    this.drivenCalls++;
  }

  npcHurt(amount: number, _x: number, _y: number, _z: number, source: unknown): void {
    this.hurts.push({ amount, by: source });
  }

  npcEnd(why: string): void {
    this.ends.push(why);
    if (why === 'dead') this.npcDead = true;
  }
}

/** A net with a clock of its own, a list of what it said, and everything kept by default. */
function net(opts: { server?: boolean; keeps?: (id: string) => boolean } = {}): { net: NpcNet; sent: Record<string, unknown>[]; tick: (s: number) => void } {
  const sent: Record<string, unknown>[] = [];
  let now = 0;
  const n = new NpcNet(() => now);
  n.send = (msg) => sent.push(JSON.parse(JSON.stringify(msg)) as Record<string, unknown>);
  n.authority = () => (opts.server === false ? 'me' : 'server');
  if (opts.keeps) n.keeps = opts.keeps;
  return { net: n, sent, tick: (s: number) => (now += s) };
}

/** One batch's worth of time, and a little more, so the rate lets a batch through. */
const BEAT = 1 / NPC_TUNE.batchHz + 1e-6;

// --- 6: with no server nothing crosses ------------------------------------------------------------
{
  const { net: n, sent } = net({ server: false });
  const a = new Stand('w:1:1');
  n.add(a);
  n.step(1);
  ok(!n.active && sent.length === 0, '6: with no server nothing is sent at all');
  ok(n.mine('w:1:1') && n.mine('anything'), '6: and every creature is this browser\'s own');
  ok(!a.driven && a.drivenCalls === 0, '6: nothing is ever driven from elsewhere');
  ok(!n.askHit('w:1:1', 10, 0, 0, 0) && sent.length === 0, '6: a blow is never asked of anybody: it lands where it was struck');
}

// --- 7: a keeper's batch --------------------------------------------------------------------------
{
  const { net: n, sent } = net();
  const a = new Stand('w:1:1');
  a.at = [1.234, 2, 3];
  a.heading = 0.5;
  a.state = 'chase';
  a.speed = 3.5;
  a.health = 0.75;
  n.add(a);
  n.step(0.01);
  const batch = sent[0] as { t: string; r: NpcRow[] };
  ok(batch?.t === 'npcState' && batch.r.length === 1, '7: what this browser keeps goes out as one batch, the first of them at once');
  ok(batch.r[0].i === 'w:1:1' && batch.r[0].p[0] === 1.23 && batch.r[0].s === 'chase' && batch.r[0].v === 3.5 && batch.r[0].hp === 0.75, `7: the row is where it is and what it is doing, cut to the centimetre (${JSON.stringify(batch.r[0])})`);
  n.step(0.01);
  ok(sent.length === 1, '7: and every one after it goes at the batch\'s own rate, not on every step');
  a.mark = 'hit';
  n.step(BEAT);
  const second = sent[1] as { r: NpcRow[] };
  ok(second.r[0].f === 'hit', '7: something that must be seen once goes with the next batch');
  n.step(BEAT);
  ok((sent[2] as { r: NpcRow[] }).r[0].f === undefined, '7: and goes once, not in every batch after it');
  a.ready = false;
  const before = sent.length;
  n.step(BEAT);
  ok(sent.length === before, '7: a creature with nothing worth saying yet is not a batch of its own');
}

// --- 8: driven from elsewhere ---------------------------------------------------------------------
{
  const theirs = new Set(['w:1:2']);
  const { net: n, sent } = net({ keeps: (id) => !theirs.has(id) });
  const mine = new Stand('w:1:1');
  const yours = new Stand('w:1:2');
  n.add(mine);
  n.add(yours);
  ok(yours.driven && !mine.driven, '8: a creature the grants give to somebody else is driven the moment it is stood');
  n.step(BEAT);
  const batch = sent.find((m) => m.t === 'npcState') as { r: NpcRow[] };
  ok(batch.r.length === 1 && batch.r[0].i === 'w:1:1', '8: a keeper says nothing about a creature it does not keep');
  n.handle({ t: 'npcState', r: [row({ i: 'w:1:2', p: [5, 6, 7] }), row({ i: 'w:1:1', p: [9, 9, 9] })] });
  ok(yours.drives.length === 1 && yours.at[0] === 5, '8: a row about a driven creature moves it');
  ok(yours.drives[0].snap, '8: and the first word about one is arrived at rather than walked toward');
  ok(mine.drives.length === 0 && mine.at[0] === 0, '8: a row about one this browser thinks for moves nothing: the grant is the only truth');
  n.handle({ t: 'npcState', r: [row({ i: 'w:1:2', p: [5, 6, 8] })] });
  ok(yours.drives.length === 2 && !yours.drives[1].snap, '8: every word after the first is walked toward');
  // The grant changes: it becomes this browser's.
  theirs.delete('w:1:2');
  n.step(BEAT);
  ok(!yours.driven && yours.drivenCalls === 2, '8: a creature handed over is told once, and only when the answer changed');
  n.step(BEAT);
  ok(yours.drivenCalls === 2, '8: and is not told again on every batch');
  const after = sent.filter((m) => m.t === 'npcState').pop() as { r: NpcRow[] };
  ok(after.r.length === 2, '8: once it is this browser\'s, it is in the batch');
}

// --- 9: a blow is asked for, never applied --------------------------------------------------------
{
  const { net: n, sent } = net({ keeps: (id) => id !== 'w:1:2' });
  const mine = new Stand('w:1:1');
  const yours = new Stand('w:1:2');
  n.add(mine);
  n.add(yours);
  ok(n.askHit('w:1:2', 12, 1, 2, 3, 'blaster'), '9: a blow against a creature somebody else keeps is asked for');
  const ask = sent.find((m) => m.t === 'npcHit') as { i: string; a: number; at: number[]; w: string };
  ok(ask.i === 'w:1:2' && ask.a === 12 && ask.at.join() === '1,2,3' && ask.w === 'blaster', `9: and carries which creature, how much, where and what struck (${JSON.stringify(ask)})`);
  ok(yours.hurts.length === 0, '9: nothing is taken off here: the keeper is the only place a number comes off');
  ok(n.askHit('w:1:2', 12, 1, 2, 3, 'blaster', true), '9: and one the player struck themselves is asked for in the same way');
  ok((sent.filter((m) => m.t === 'npcHit').pop() as { b?: number }).b === 1, '9: saying that it was the player, which is the whole of what crosses about who struck');
  ok((ask as { b?: number }).b === undefined, '9: while a blow from this browser\'s own creatures blames nobody, since nobody there can name them');
  n.attacker = (id) => ({ key: id } as never);
  n.handle({ t: 'npcHurt', i: 'w:1:1', a: 7, at: [1, 1, 1], id: 4, b: 1 });
  ok(mine.hurts.length === 1 && mine.hurts[0].amount === 7, '9: a blow handed over is applied to a creature this browser keeps');
  ok((mine.hurts[0].by as { key: number }).key === 4, '9: with whoever struck, so it turns on the right person');
  // Every blow carries the connection it came through, and that names the browser rather than the
  // striker. Blamed on their player, a bite from their own wildlife would set this creature and its
  // whole pack on somebody who never touched it.
  n.handle({ t: 'npcHurt', i: 'w:1:1', a: 2, at: [1, 1, 1], id: 4 });
  ok(mine.hurts.length === 2 && mine.hurts[1].by === null, '9: a blow that does not say the player struck it lands with nobody to blame');
  n.handle({ t: 'npcHurt', i: 'w:1:2', a: 7, at: [1, 1, 1], id: 4, b: 1 });
  ok(yours.hurts.length === 0, '9: and is refused outright for one this browser does not keep');
  n.attacker = () => {
    throw new Error('no');
  };
  n.handle({ t: 'npcHurt', i: 'w:1:1', a: 3, at: [0, 0, 0], id: 9, b: 1 });
  ok(mine.hurts.length === 3 && mine.hurts[2].by === null, '9: a hook that throws costs that one blow its blame and no more');
  n.handle({ t: 'npcHurt', i: 'w:1:1', a: 0 });
  n.handle({ t: 'npcHurt', a: 5 });
  ok(mine.hurts.length === 3, '9: a blow that takes nothing, and one naming no creature, do nothing');
}

// --- 10: a death happens once and stays -----------------------------------------------------------
{
  const { net: n, sent } = net({ keeps: (id) => id !== 'w:1:2' });
  const yours = new Stand('w:1:2');
  n.add(yours);
  n.handle({ t: 'npcGone', i: 'w:1:2', why: 'dead' });
  ok(yours.ends.join() === 'dead' && n.isDead('w:1:2'), '10: the keeper\'s word is what kills it, and it is remembered');
  n.handle({ t: 'npcState', r: [row({ i: 'w:1:2', hp: 1 })] });
  ok(yours.drives.length === 0, '10: a late row from the keeper that had it cannot stand it back up');
  const again = new Stand('w:1:2');
  n.add(again);
  ok(again.ends.join() === 'dead', '10: nor can standing the body again: it is ended in the same breath');
  ok(n.askHit('w:1:2', 5, 0, 0, 0) && !sent.some((m) => m.t === 'npcHit'), '10: and nobody asks a keeper to kill it twice');
  // A creature of this browser's own that dies: said once, and never for a second time.
  const mine = new Stand('w:1:1');
  n.add(mine);
  mine.npcDead = true;
  n.step(BEAT);
  n.step(BEAT);
  ok(sent.filter((m) => m.t === 'npcGone' && m.i === 'w:1:1').length === 1, '10: a death of this browser\'s own is announced exactly once');
}

// --- 10b: one death, not two ----------------------------------------------------------------------
{
  // The world's own spawn list carries a death already. Where something takes that word, this module
  // says nothing of its own: two words for one death would be two paths for the same thing.
  const { net: n, sent } = net();
  const said: string[] = [];
  n.died = (id) => {
    said.push(id);
    return true;
  };
  const mine = new Stand('w:1:1');
  n.add(mine);
  mine.npcDead = true;
  n.step(BEAT);
  ok(said.join() === 'w:1:1' && !sent.some((m) => m.t === 'npcGone'), '10b: where the world\'s list takes the death, this module says nothing of its own');
  const buried = new Set(['w:1:3']);
  n.buried = (id) => buried.has(id);
  ok(n.isDead('w:1:3') && !n.isDead('w:1:4'), '10b: and a death the list heard counts here as though this module had heard it');
  const late = new Stand('w:1:3');
  n.add(late);
  ok(late.ends.join() === 'dead', '10b: so a body stood for one the list buried is ended in the same breath');
  n.buried = () => {
    throw new Error('no');
  };
  ok(!n.isDead('w:1:9'), '10b: a hook that throws is read as "not dead" rather than taking the message down');
  n.buried = () => false;
  // The word the world's list heard, handed straight over.
  const { net: m2 } = net({ keeps: () => false });
  const theirs = new Stand('w:1:5');
  m2.add(theirs);
  m2.noteGone('w:1:5', 'gone');
  ok(theirs.ends.join() === 'gone' && !m2.isDead('w:1:5'), '10b: one taken down rather than killed ends the body and is not a death');
}

// --- 11: rows about creatures with no body here ---------------------------------------------------
{
  const { net: n } = net({ keeps: () => false });
  n.handle({ t: 'npcState', r: [row({ i: 'w:1:5', p: [11, 12, 13] })] });
  ok(n.debug().waiting === 1, '11: a row about a creature with no body here is kept until there is one');
  const late = new Stand('w:1:5');
  n.add(late);
  ok(late.drives.length === 1 && late.drives[0].snap && late.at[0] === 11, '11: and the body, when it is stood, is put where the creature really is');
  ok(n.debug().waiting === 0, '11: which is the end of keeping it');
  const before = NPC_TUNE.remembered;
  NPC_TUNE.remembered = 2;
  n.handle({ t: 'npcState', r: [row({ i: 'a1' }), row({ i: 'a2' }), row({ i: 'a3' })] });
  ok(n.debug().waiting === 2 && n.debug().refused === 1, '11: past as many as may be remembered the rest are dropped and counted');
  NPC_TUNE.remembered = before;
}

// --- 12: more creatures than one batch carries ----------------------------------------------------
{
  const { net: n, sent } = net();
  const cap = 4;
  const was = NPC_TUNE.rows;
  NPC_TUNE.rows = cap;
  for (let i = 0; i < 10; i++) n.add(new Stand(`w:1:${i}`));
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) {
    n.step(BEAT);
    for (const r of (sent[i] as { r: NpcRow[] }).r) seen.add(r.i);
  }
  ok((sent[0] as { r: NpcRow[] }).r.length === cap, `12: a batch carries as many as it may and no more (${cap})`);
  ok(seen.size === 10, `12: and a keeper holding more takes them in turn, so every one is spoken about (${seen.size} of 10)`);
  NPC_TUNE.rows = was;
}

// --- 13: the line dropping ------------------------------------------------------------------------
{
  const { net: n, sent } = net({ keeps: () => false });
  const yours = new Stand('w:1:2');
  n.add(yours);
  ok(yours.driven, '13: it is driven while the server says so');
  n.clear();
  ok(!yours.driven, '13: and goes back to being this browser\'s own when the line drops, rather than standing still for ever');
  ok(n.debug().held === 0 && n.debug().deaths === 0, '13: nothing of the world that has gone is kept');
  n.step(BEAT);
  ok(!sent.length, '13: and there is nothing left to say');
}

// --- 14: what the wire will not take ---------------------------------------------------------------
{
  const { net: n } = net({ keeps: () => false });
  const yours = new Stand('w:1:2');
  n.add(yours);
  ok(!n.handle({ t: 'hello' }) && !n.handle({}), '14: a word this module does not own is left for whoever does');
  n.handle({ t: 'npcState', r: 'all of them' });
  n.handle({ t: 'npcState' });
  ok(yours.drives.length === 0, '14: a batch whose rows are not a list moves nothing');
  n.handle({ t: 'npcState', r: [{ i: 'w:1:2', p: ['x', 2, 3] }, { i: 'w:1:2' }, null] });
  ok(yours.drives.length === 0, '14: nor does a row whose place is not three numbers');
  n.handle({ t: 'npcState', r: [{ i: 'w:1:2', p: [1, 2, 3], s: 7, hp: 'most' }] });
  ok(yours.drives.length === 1 && yours.drives[0].row.s === 'idle' && yours.drives[0].row.hp === 1, '14: a row with rubbish in its words is read through the checks rather than refused');
}

// --- 15: a creature dying while it changes hands --------------------------------------------------
{
  // The grants go out twice a second and the batches four times, so the two cross. A creature killed
  // here in the quarter-second its grant moved away must still be announced: swallowed, it is dead on
  // this screen and alive on every other, and the browser that took it over runs a live brain for
  // something the player watched fall. The server's own grace (`mayKill`) is what takes the word.
  const theirs = new Set<string>();
  const { net: n, sent } = net({ keeps: (id) => !theirs.has(id) });
  const mine = new Stand('w:1:1');
  n.add(mine);
  n.step(BEAT);
  mine.npcDead = true;
  theirs.add('w:1:1');
  n.step(BEAT);
  ok(sent.filter((m) => m.t === 'npcGone' && m.i === 'w:1:1').length === 1, '15: a death decided here is announced although the creature has just changed hands');
  n.step(BEAT);
  ok(sent.filter((m) => m.t === 'npcGone' && m.i === 'w:1:1').length === 1, '15: and still exactly once');
  ok(!sent.some((m) => m.t === 'npcState' && (m.r as NpcRow[]).some((r) => r.i === 'w:1:1' && r.hp === 0)), '15: and nothing more is said about the body');
}

// --- 15b: a death arriving just after this browser was handed the creature -------------------------
{
  // The other way round. A death is never stale: it is the keeper's own decision, the server passes
  // it on, and it happens once and stays. Ended only while driven, this left a live body standing
  // here that everybody else had buried -- and, since the id was already counted as said, its death
  // here was never announced either, so it stood for the life of the world.
  const { net: n, sent } = net({ keeps: () => true });
  const ours = new Stand('w:1:2');
  n.add(ours);
  ok(!ours.driven, '15b: the grant has just moved, so this browser thinks for it');
  n.noteGone('w:1:2', 'dead');
  ok(ours.ends.join() === 'dead' && n.isDead('w:1:2'), '15b: a death that arrives a moment later still ends the body here');
  n.step(BEAT);
  ok(!sent.some((m) => m.t === 'npcGone'), '15b: and is not said back to the world that just said it');
  const taken = new Stand('w:1:3');
  n.add(taken);
  n.noteGone('w:1:3', 'gone');
  ok(taken.ends.join() === 'gone' && !n.isDead('w:1:3'), '15b: one taken down by an admin ends the body here too, and is not a death');
  n.step(BEAT);
  ok(!sent.some((m) => m.t === 'npcGone'), '15b: nor is that said back');
}

// --- 16: a grant this browser cannot honour --------------------------------------------------------
{
  // Keeping a creature means saying where it has got to. A browser with no body for one -- its
  // catalogue does not know the species, or the model is still in flight -- says nothing about it,
  // and nothing about that is visible from anywhere else: it is talking normally, so the server's
  // silence rule never reaches it, and it is the nearest, so every pass hands the creature straight
  // back. Frozen on every screen, for the life of the world. So it hands the grant back itself.
  const wasKeep = NPC_TUNE.cannotKeepSeconds;
  NPC_TUNE.cannotKeepSeconds = 1;
  const { net: n, sent, tick } = net();
  const notes: string[] = [];
  n.onNote = (text) => notes.push(text);
  const here = new Stand('w:1:1');
  n.add(here);
  n.granted = () => ['w:1:1', 'w:1:9'];
  for (let i = 0; i < 8; i++) {
    tick(BEAT);
    n.step(BEAT);
  }
  const back = sent.filter((m) => m.t === 'npcDrop');
  ok(back.length === 1 && back[0].i === 'w:1:9', `16: a grant this browser has no body for is handed back, once (${JSON.stringify(back)})`);
  ok(!sent.some((m) => m.t === 'npcDrop' && m.i === 'w:1:1'), '16: and one it can really speak for is not');
  ok(n.debug().handedBack === 1, '16: which the console can read');
  ok(notes.length === 1, '16: and the player is told, once, rather than four times a second');
  // A body that is there but has nothing to say yet (its model is still loading) is the same case:
  // it is handed back rather than left frozen, and taken again when the model lands.
  const late = new Stand('w:1:7');
  late.ready = false;
  n.add(late);
  n.granted = () => ['w:1:7'];
  for (let i = 0; i < 8; i++) {
    tick(BEAT);
    n.step(BEAT);
  }
  ok(sent.some((m) => m.t === 'npcDrop' && m.i === 'w:1:7'), '16: a body that cannot say anything yet is handed back too');
  n.granted = () => {
    throw new Error('no');
  };
  tick(BEAT);
  n.step(BEAT);
  ok(true, '16: and a hook that throws costs that one pass and nothing else');
  NPC_TUNE.cannotKeepSeconds = wasKeep;
}

// --- 17: rows of a world this browser has left ------------------------------------------------------
{
  // A row parked for a body that does not exist here is refreshed four times a second while the
  // creature is really out there; one belonging to a world that has been left is refreshed never.
  // Kept for ever they fill the allowance, and then the roster a browser is sent on arriving -- the
  // one message that exists to stop creatures being stood at their spawn points and walked across
  // the world -- is refused row by row.
  const wasRemembered = NPC_TUNE.remembered;
  NPC_TUNE.remembered = 1;
  const { net: n, tick } = net({ keeps: () => false });
  n.handle({ t: 'npcState', r: [row({ i: 'old:1' })] });
  ok(n.debug().waiting === 1, '17: a row about a body that is not here is kept');
  tick(NPC_TUNE.parkSeconds + 1);
  n.handle({ t: 'npcState', r: [row({ i: 'new:1' })] });
  ok(n.debug().waiting === 1 && n.debug().refused === 0, '17: and makes way for the world this browser is standing in rather than refusing it');
  n.noteGone('buried:1', 'dead');
  n.freshWorld();
  ok(n.debug().waiting === 0, '17: arriving on a world forgets where the last one\'s creatures were');
  ok(n.isDead('buried:1'), '17: and forgets no death, because forgetting one is how a creature comes back to life');
  NPC_TUNE.remembered = wasRemembered;
}

console.log(`\n${checks} checks passed`);
