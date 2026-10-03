// The world's creatures as they cross between browsers: what the relay keeps of a keeper's batch, a
// blow asked of a keeper and the word that one has gone (server/npcWire.mjs), then the browser's own
// half of the same thing (src/net/npcNet.ts) -- who is driven and who is kept, that a blow is never
// applied to something this browser does not keep, that a death happens once and stays, and that a
// keeper holding more creatures than one batch carries says something about every one of them. From
// 21 on: the rolls, jumps, postures and cover a row now carries, a bolt's flight on a blow so the
// keeper's blade can answer it, a creature's blow on another player, the seen ones going on the wire by
// saying so, a seen death held for exactly its respawn, and a follower leaving the wire.
//
// Synthetic messages and a stand-in creature only: nothing here builds a world, and the stand-in is
// the `NpcSubject` interface and nothing else, which is the whole point of that interface.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NPC_WIRE, NpcPlaces, cleanNpcBatch, cleanNpcBlow, cleanNpcDrop, cleanNpcGone, cleanNpcHit, cleanNpcRow, npcId } from '../../../server/npcWire.mjs';
import { NPC_TUNE, NpcNet, copyBrain, mayFight, neverShared, sharesOnWire, sharesSeen, targetOf, targetWord, type NpcBolt, type NpcRow, type NpcSubject } from '../../../src/net/npcNet.ts';
import { PLAYER_KEY } from '../../../src/combat/kit.ts';
import { STRIKER_SLOTS, Strikers } from '../../../src/combat/strikers.ts';
import { OWN_TUNE, Owned } from '../../../src/net/owned.ts';
import { roomKey } from '../../../server/rooms.mjs';

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
  hurts: { amount: number; by: unknown; what?: string; bolt?: NpcBolt | null }[] = [];
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
    // The mind copied as the row stood at this moment, as the mobile copies it: the object it arrived
    // in is refilled by the next row of the batch.
    this.drives.push({ row: { ...row, p: [...row.p], b: row.b ? { ...row.b } : undefined }, snap });
    this.at = [row.p[0], row.p[1], row.p[2]];
    this.health = row.hp;
  }

  npcSetDriven(driven: boolean): void {
    this.driven = driven;
    this.drivenCalls++;
  }

  npcHurt(amount: number, _x: number, _y: number, _z: number, source: unknown, what = '', bolt: NpcBolt | null = null): void {
    // The bolt is copied as it stood: the object it arrived in is the module's own and is refilled.
    this.hurts.push({ amount, by: source, what, bolt: bolt ? { ...bolt } : null });
  }

  npcEnd(why: string): void {
    this.ends.push(why);
    if (why === 'dead') this.npcDead = true;
  }

  /** Who struck it lately, by living key, as the test sets them. */
  struck: number[] = [];
  npcStruckBy(_seconds: number, out: number[]): void {
    out.length = 0;
    for (const k of this.struck) out.push(k);
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

// --- 18: what this browser seeded for itself never goes on the wire as one of the server's records --
{
  // A lair's creature, a person standing about and a ticket collector each stand under a world name
  // the server never stood. Handed to this module as one of the server's own, one was marked driven the
  // moment a server answered -- nobody had been granted it -- and stood frozen and unhurtable for as
  // long as the line was up. Only a body stood from one of the server's own records asks to be shared
  // that way; the seeded kind is shared another way, by saying it has been seen (21 onward).
  for (const id of ['wild:1234', 'stood:17', 'travel:tatooine:4', 'ours:3']) ok(!sharesOnWire(id, undefined), `18: ${id} is not shared unless it asks to be`);
  ok(sharesOnWire('w:1:7', true), '18: while one the server stood asks, and is');
  ok(!sharesOnWire('', true) && !sharesOnWire(undefined, true), '18: and nothing with no world name can be');

  // What this module does with a body that *is* handed to it, which is the freeze itself: with a server
  // answering and nobody granted it, a body on the wire is driven. The gate above is what keeps a
  // seeded one from ever being handed over, and the text check below is what pins the manager to that
  // gate -- together they are the real guard, since the manager cannot be loaded here.
  const { net: n } = net({ keeps: () => false });
  const served = new Stand('w:1:7');
  n.add(served);
  for (let i = 0; i < 4; i++) n.step(BEAT);
  ok(served.driven, "18: a body on the wire that nobody here was granted is driven, which is why a seeded one must never reach it");
  ok(n.find('stood:17') === null && n.debug().held === 1, '18: and one never handed to it is unknown to it');

  // The wiring, read as text, since the manager cannot be loaded here.
  const manager = readFileSync(new URL('../../../src/world/mobiles/manager.ts', import.meta.url), 'utf8');
  ok(/if \(sharesOnWire\(opts\.worldId, opts\.share\)\) \{\s*m\.shareAs\(opts\.worldId\);\s*npcNow\(\)\?\.add\(m\);/.test(manager), '18: the manager puts a body on the wire only through that gate');
  ok(/worldId: a\.id, listed: true, share: true, \.\.\.weapon \}\)/.test(manager), "18: and a record of the server's own is the one that asks for it, with the weapon it names");
  ok(/\} else this\.shareSeen\(m, opts\.worldId, !!opts\.essential, opts\.respawn \?\? 0\);/.test(manager), '18: every other body with a world name goes the seen way, which asks the seen gate itself');
  const world = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  ok(!/worldId: `(wild|stood):\$\{seed\}`[^}]*share: true/.test(world), '18: while the lairs and the standing people never do');
}

// --- 19: naming what a creature is fighting ---------------------------------------------------------
{
  // Two browsers, 4 and 9. On 4 the player is PLAYER_KEY and 9's figure holds key 55; on 9 the other
  // way round, with 4's figure at key 61. A creature crosses naming who it fights by relay id.
  const peersOn4 = new Map([[55, 9]]);
  const peersOn9 = new Map([[61, 4]]);
  const peerOf = (m: Map<number, number>) => (key: number) => m.get(key) ?? 0;
  const keyOf = (m: Map<number, number>) => (id: number) => [...m].find(([, v]) => v === id)?.[0] ?? 0;

  ok(targetWord(PLAYER_KEY, '', 4, peerOf(peersOn4)) === 'p:4', "19: a keeper names its own player by its own relay id");
  ok(targetWord(55, '', 4, peerOf(peersOn4)) === 'p:9', "19: and another player's figure by that player's");
  ok(targetWord(123, 'w:1:7', 4, peerOf(peersOn4)) === 'w:1:7', '19: and a creature by the id the world knows it by');
  ok(targetWord(PLAYER_KEY, '', 0, peerOf(peersOn4)) === '' && targetWord(123, '', 4, peerOf(peersOn4)) === '', '19: with no relay id, or nothing nameable, it names nobody');

  // Read on the other browser, each word lands on the same person it was written about.
  const on9 = (w: string) => targetOf(w, 9, keyOf(peersOn9));
  const on4 = (w: string) => targetOf(w, 4, keyOf(peersOn4));
  ok(JSON.stringify(on9('p:4')) === JSON.stringify({ key: 61 }), "19: 4's own player, read on 9, is 4's figure there -- not 9's own player, which is what 'p' was read as");
  ok(JSON.stringify(on9('p:9')) === JSON.stringify({ key: PLAYER_KEY }), "19: and 9's player, named on 4, is 9's own player");
  ok(JSON.stringify(on4(targetWord(61, '', 9, peerOf(peersOn9)))) === JSON.stringify({ key: PLAYER_KEY }), '19: round the other way it maps back to the player it began with');
  ok(on9('p:12') === null, '19: a player this browser holds no figure for is nobody, and the creature picks its own fight');
  ok(JSON.stringify(on9('w:1:7')) === JSON.stringify({ npc: 'w:1:7' }), '19: a creature is looked for by its id');
  ok(on9('') === null, '19: and nothing is nothing');

  // The module's own methods ask the game's hooks and make each player's word once.
  const n = new NpcNet(() => 0);
  n.selfId = () => 4;
  n.peerOfKey = (key) => peersOn4.get(key) ?? 0;
  n.keyOfPeer = (id) => keyOf(peersOn4)(id);
  ok(n.nameTarget(PLAYER_KEY, '') === 'p:4' && n.nameTarget(55, '') === 'p:9' && n.nameTarget(3, 'w:1:7') === 'w:1:7', '19: the module names targets exactly as the rule does');
  // A reconnect hands out a new relay id, and the word kept for this browser's own player must follow
  // it, or a creature handed over afterwards is sent after whoever holds the old number.
  n.selfId = () => 7;
  ok(n.nameTarget(PLAYER_KEY, '') === 'p:7' && JSON.stringify(n.readTarget('p:7')) === JSON.stringify({ key: PLAYER_KEY }), '19: a new relay id names the player by the new number, not the one the word was first made for');
  n.selfId = () => 4;
  ok(JSON.stringify(n.readTarget('p:4')) === JSON.stringify({ key: PLAYER_KEY }) && JSON.stringify(n.readTarget('p:9')) === JSON.stringify({ key: 55 }), '19: and reads them back through the same hooks');
  n.peerOfKey = () => {
    throw new Error('no');
  };
  ok(n.nameTarget(55, '') === '', '19: a hook that throws names nobody rather than taking the batch down');
}

// --- 20: a creature's mind arrives with its row ----------------------------------------------------
{
  // The keeper wrote it and the server passed it on, and this side dropped it on the floor: a
  // creature changing hands forgot everything on its mind.
  const { net: n } = net({ keeps: () => false });
  const yours = new Stand('w:1:2');
  n.add(yours);
  n.handle({ t: 'npcState', id: 6, r: [row({ i: 'w:1:2', b: { t: 'p:4', st: 2, gx: 5, gz: -3 } })] });
  const b1 = yours.drives[0]?.row.b;
  ok(b1?.t === 'p:4' && b1.st === 2 && b1.gx === 5 && b1.gz === -3, `20: what it is fighting, its stun and where it was walking arrive with the row (${JSON.stringify(b1)})`);
  n.handle({ t: 'npcState', id: 6, r: [row({ i: 'w:1:2', b: { t: 'p' } })] });
  ok(yours.drives[1]?.row.b?.t === 'p:6', "20: a bare 'p' from an older browser is its keeper's own player, named by the id the relay stamped the batch with");
  n.handle({ t: 'npcState', id: 6, r: [row({ i: 'w:1:2', b: 'nonsense' }), row({ i: 'w:1:2' })] });
  ok(yours.drives[2]?.row.b === undefined && yours.drives[3]?.row.b === undefined, '20: a mind that is not one, and a row with none, carry none');
  // The mind is read into one object kept beside the row, so one creature's must not reach the next
  // row of the same batch: a row with a stun and no target is a creature fighting nobody.
  const other = new Stand('w:1:3');
  n.add(other);
  n.handle({ t: 'npcState', id: 6, r: [row({ i: 'w:1:2', b: { t: 'p:4', gx: 1, gz: 2 } }), row({ i: 'w:1:3', b: { sl: 1 } })] });
  const first = yours.drives[yours.drives.length - 1]?.row.b;
  const second = other.drives[other.drives.length - 1]?.row.b;
  ok(first?.t === 'p:4' && second?.sl === 1 && second.t === undefined && second.gx === undefined, `20: one creature's target and walk do not carry over to the next row of the batch (${JSON.stringify(second)})`);

  // A row kept for a body not yet built keeps its own mind, **after** later batches about other
  // creatures have refilled the object it was read into.
  n.handle({ t: 'npcState', id: 6, r: [row({ i: 'w:1:9', b: { t: 'p:4', sl: 1 } })] });
  n.handle({ t: 'npcState', id: 6, r: [row({ i: 'w:1:10', b: { t: 'w:1:3', st: 5 } })] });
  n.handle({ t: 'npcState', id: 6, r: [row({ i: 'w:1:2', b: { gx: 9, gz: 9 } })] });
  const later = new Stand('w:1:9');
  n.add(later);
  const kept = later.drives[0]?.row.b;
  ok(kept?.t === 'p:4' && kept.sl === 1 && kept.st === undefined && kept.gx === undefined, `20: and a row kept for a body not yet built keeps its own mind for it, whatever was heard since (${JSON.stringify(kept)})`);

  // Copied field by field, into a fresh object or over one already kept.
  const full = { t: 'p:4', st: 1, sl: 2, bd: 3, bs: 4, gx: 5, gz: 6 };
  const fresh = copyBrain(full, null);
  ok(fresh !== full && JSON.stringify(fresh) === JSON.stringify(full), `20: a mind is copied whole, every field of it (${JSON.stringify(fresh)})`);
  const held = { t: 'w:1:1', st: 9, sl: 9, bd: 9, bs: 9, gx: 9, gz: 9 };
  const over = copyBrain({ sl: 2 }, held);
  ok(over === held && over.sl === 2 && Object.values({ ...over, sl: undefined }).every((v) => v === undefined), '20: and over a kept one, what the new mind leaves out is cleared rather than left from the last');

  // The mobile copies what it is told rather than holding the row, which is refilled.
  const mobile = readFileSync(new URL('../../../src/world/mobiles/mobile.ts', import.meta.url), 'utf8');
  ok(/this\.heldBrain = row\.b \? copyBrain\(row\.b, this\.heldBrain\) : null;/.test(mobile), '20: a driven copy keeps its own copy of the last mind it was told');
}

// ---------------------------------------------------------------------------------------------------
// The seen ones, and everything that crosses about a fight.

// --- 21: the new things a row carries -----------------------------------------------------------------
{
  const roll = cleanNpcRow(row({ f: 'roll', fd: 'L' }));
  ok(roll?.f === 'roll' && roll.fd === 'L', '21: a roll crosses with the way it went, which picks its clip');
  const jump = cleanNpcRow(row({ f: 'jump', fd: 'B', ff: 1 }));
  ok(jump?.f === 'jump' && jump.fd === 'B' && jump.ff === 1, "21: a jump with its way and whether it was the Force's");
  ok(cleanNpcRow(row({ f: 'block' }))?.f === 'block', '21: a blade turning a bolt away is a mark of its own');
  ok(cleanNpcRow(row({ f: 'hit', fd: 'L', ff: 1 }))?.fd === undefined && cleanNpcRow(row({ f: 'roll', ff: 1 }))?.ff === undefined, '21: a way and a Force flag ride only the marks they belong to');
  ok(cleanNpcRow(row({ f: 'roll', fd: 'up' }))?.fd === undefined, '21: a way nobody knows is dropped');
  const low = cleanNpcRow(row({ po: 'kneel', cv: 1 }));
  ok(low?.po === 'kneel' && low.cv === 1, '21: how low it stands and that it is in cover are carried');
  const plain = cleanNpcRow(row({ po: 'lying', cv: true })) as Record<string, unknown>;
  ok(plain.po === undefined && plain.cv === undefined, '21: a posture nobody knows, and cover that is not the one flag, are nothing');
  ok(Object.keys(cleanNpcRow(row()) as object).join() === 'i,p,h,s,v,hp', '21: and a body upright in the open says none of it, so its row is what it always was');
}

// --- 22: a bolt's flight on a blow, and a creature's blow on a player ----------------------------------
{
  const hit = cleanNpcHit({ i: 'w:1:7', a: 5, d: [0, 0, 2], s: 99999, c: 0x00ff00, z: 50 }) as Record<string, unknown>;
  ok(JSON.stringify(hit.d) === '[0,0,1]' && hit.s === NPC_WIRE.boltSpeed && hit.c === 0x00ff00 && hit.z === 10, `22: a bolt's way is made a direction and its speed and size are capped (${JSON.stringify(hit)})`);
  const flat = cleanNpcHit({ i: 'w:1:7', a: 5, d: [0, 0, 0], s: 100 }) as Record<string, unknown>;
  ok(flat.d === undefined && flat.s === undefined, '22: a way of no length is no bolt, and nothing about one rides the blow');
  ok((cleanNpcHit({ i: 'w:1:7', a: 5, d: [1, 0, 0] }) as Record<string, unknown>).c === 0xff4a2a, '22: a bolt with no colour is the plain blaster\'s');
  ok((cleanNpcHit({ i: 'w:1:7', a: 5 }) as Record<string, unknown>).d === undefined, '22: and a blade, a blast or a bite carries none');
  const blow = cleanNpcBlow({ to: 4, i: 'wild:t:1:0', a: 12, at: [1, 2, 3], w: 'hull' });
  ok(blow?.to === 4 && blow.i === 'wild:t:1:0' && blow.a === 12 && blow.at[2] === 3 && blow.w === 'hull', `22: a creature's blow on a player names the player, the creature, how much, where and what (${JSON.stringify(blow)})`);
  ok(cleanNpcBlow({ to: 0, i: 'w:1', a: 5 }) === undefined && cleanNpcBlow({ to: 1.5, i: 'w:1', a: 5 }) === undefined && cleanNpcBlow({ to: 'x', i: 'w:1', a: 5 }) === undefined, '22: with nobody real to strike it is no blow');
  ok(cleanNpcBlow({ to: 4, a: 5 }) === undefined && cleanNpcBlow({ to: 4, i: 'w:1', a: 0 }) === undefined, '22: nor with no creature or nothing taken');
  ok(cleanNpcBlow({ to: 4, i: 'w:1', a: 1e12 })?.a === NPC_WIRE.damage && cleanNpcBlow({ to: 4, i: 'w:1', a: 5 })?.at.join() === '0,0,0', '22: a blow past the cap is cut to it, and one with no place is still a blow');
}

// --- 23: the places remember a posture and cover, and forget them when they are gone -------------------
{
  const places = new NpcPlaces({ remember: 8 });
  places.note('t', [cleanNpcRow(row({ i: 'a', po: 'prone', cv: 1, f: 'roll', fd: 'L' }))!]);
  const first = places.rows('t')[0] as Record<string, unknown>;
  ok(first.po === 'prone' && first.cv === 1 && first.f === undefined && first.fd === undefined, '23: a newcomer is told a body is lying behind something, and not about the roll that put it there');
  places.note('t', [cleanNpcRow(row({ i: 'a' }))!]);
  const after = places.rows('t')[0] as Record<string, unknown>;
  ok(after.po === undefined && after.cv === undefined, '23: and once it stands up in the open again, so is the next one');
}

// --- 24: the seen ones go on the wire by saying so -----------------------------------------------------
{
  ok(sharesSeen('wild:t:1:0', false, true) && sharesSeen('stood:t:3', false, true) && sharesSeen('camp:t:2', false, true), '24: a lair\'s creature, a person at a post and a nest are shared by being seen');
  ok(!sharesSeen('travel:t:4', false, true) && !sharesSeen('ours:3', false, true) && !sharesSeen('k4', false, true), '24: a ticket collector, one of ours and an admin\'s are not');
  ok(!sharesSeen('stood:t:3', true, true), '24: nor is one nobody may strike: it is the same in every browser and needs no keeper');
  ok(!sharesSeen('wild:t:1:0', false, false), '24: and nothing is, with no server that speaks of them');
  ok(neverShared({ follow: {} }) && neverShared({ companion: true }) && !neverShared({}) && !neverShared(null), '24: a follower, and later a companion, is never shared at all');

  const { net: n, sent, tick } = net({ keeps: () => false });
  const said: { id: string; at: { x: number; y: number; z: number }; r: number }[] = [];
  const putDown: string[] = [];
  let seeding = true;
  n.seeding = () => seeding;
  n.seen = (id, at, r) => said.push({ id, at: { ...at }, r });
  n.unseen = (id) => putDown.push(id);
  const lair = new Stand('wild:t:1:0');
  lair.at = [4, 5, 6];
  n.addSeen(lair, { x: 4, y: 5, z: 6 }, 300);
  ok(said.length === 1 && said[0].id === 'wild:t:1:0' && said[0].at.z === 6 && said[0].r === 300, '24: standing one says it has been seen, where and how long it stays down');
  ok(lair.driven && n.find('wild:t:1:0') === lair, '24: and it waits driven, holding its post, until the server says who keeps it');
  // Nobody speaks about it: said again, once a while, in case the first word was lost.
  for (let i = 0; i < Math.ceil(NPC_TUNE.reseeSeconds / BEAT) + 2; i++) {
    tick(BEAT);
    n.step(BEAT);
  }
  ok(said.length === 2 && n.debug().reseen === 1, `24: a seen body nobody speaks about is said again after ${NPC_TUNE.reseeSeconds} s, once (${said.length})`);
  n.handle({ t: 'npcState', id: 5, r: [row({ i: 'wild:t:1:0' })] });
  for (let i = 0; i < Math.ceil(NPC_TUNE.reseeSeconds / BEAT) - 4; i++) {
    tick(BEAT);
    n.step(BEAT);
    n.handle({ t: 'npcState', id: 5, r: [row({ i: 'wild:t:1:0' })] });
  }
  ok(said.length === 2, '24: and never while its keeper is speaking about it');
  n.remove('wild:t:1:0');
  ok(putDown.join() === 'wild:t:1:0', '24: putting the body down says so, so the server hands it to somebody who still has one');
  const quiet = new Stand('stood:t:5');
  n.addSeen(quiet, { x: 0, y: 0, z: 0 }, 0);
  n.remove('stood:t:5', true);
  ok(putDown.length === 1, '24: a body handing its own name straight on says nothing');
  const fell = new Stand('stood:t:6');
  n.addSeen(fell, { x: 0, y: 0, z: 0 }, 0);
  fell.npcDead = true;
  n.remove('stood:t:6');
  ok(putDown.length === 1, '24: nor does one taken down dead: its death is the word, not its body going');
  n.remove('stood:t:404');
  ok(putDown.length === 1 && !sent.some((m) => m.t === 'spawn'), '24: a name it never held says nothing, and none of it goes out as a spawn word of this module\'s own');
  const before = said.length;
  seeding = false;
  n.addSeen(new Stand('wild:t:9:9'), { x: 0, y: 0, z: 0 }, 0);
  ok(said.length === before && n.find('wild:t:9:9') === null, '24: with no server that speaks of them, nothing is said and nothing is held');
  seeding = true;
  n.addSeen(new Stand('travel:t:1'), { x: 0, y: 0, z: 0 }, 0);
  ok(said.length === before && n.find('travel:t:1') === null, '24: and a name that is not of the seen kind is never said, whatever asks');
}

// --- 25: a seen death is held for its respawn, and a fresh life is announced afresh ------------------------
{
  const { net: n, sent, tick } = net();
  n.seeding = () => true;
  n.selfId = () => 4;
  n.peerOfKey = (key) => (key === 55 ? 9 : 0);
  const deaths: { id: string; by: number[] }[] = [];
  n.died = (id, by) => {
    deaths.push({ id, by: [...by] });
    return true;
  };
  const lair = new Stand('wild:t:2:0');
  n.addSeen(lair, { x: 0, y: 0, z: 0 }, 30);
  n.step(BEAT);
  ok(!lair.driven, '25: kept here, it thinks for itself');
  lair.struck = [PLAYER_KEY, 55, 123, 55];
  lair.npcDead = true;
  tick(BEAT);
  n.step(BEAT);
  ok(deaths.length === 1 && deaths[0].id === 'wild:t:2:0', '25: its death is said once, through the world\'s own list');
  ok(JSON.stringify(deaths[0].by) === '[4,9]', `25: naming the players who struck it by relay id, this one's own and another's, each once, and no creature (${JSON.stringify(deaths[0].by)})`);
  ok(n.isDead('wild:t:2:0'), '25: and it is dead here at once');
  n.noteGone('wild:t:2:0', 'dead', 5);
  tick(4);
  ok(n.isDead('wild:t:2:0'), '25: until the respawn the server says, and not a moment less');
  tick(2);
  ok(!n.isDead('wild:t:2:0'), '25: and then not: the same name stands again in every browser');
  const again = new Stand('wild:t:2:0');
  n.addSeen(again, { x: 0, y: 0, z: 0 }, 30);
  n.step(BEAT);
  ok(again.ends.length === 0, '25: so a body stood under it after that is a fresh life and is not ended');
  again.npcDead = true;
  tick(BEAT);
  n.step(BEAT);
  ok(deaths.length === 2, '25: and its own death, when it comes, is a new one and is said');
  // An admin's is down for good, as it always was.
  n.noteGone('k7', 'dead', 5);
  tick(3600);
  ok(n.isDead('k7'), '25: while an admin\'s creature that died stays dead for the life of the world');
  ok(!sent.some((m) => m.t === 'npcGone' && m.i === 'wild:t:2:0'), '25: nothing of it went out as a second word');
}

// --- 26: walking off with a player ---------------------------------------------------------------------
{
  const theirs = new Set(['stood:t:8']);
  const { net: n } = net({ keeps: (id) => !theirs.has(id) });
  n.seeding = () => true;
  const taken: string[] = [];
  n.taken = (id) => taken.push(id);
  const mine = new Stand('stood:t:7');
  const yours = new Stand('stood:t:8');
  n.addSeen(mine, { x: 0, y: 0, z: 0 }, 60);
  n.addSeen(yours, { x: 0, y: 0, z: 0 }, 60);
  n.step(BEAT);
  ok(n.leave('stood:t:7') && taken.join() === 'stood:t:7' && n.find('stood:t:7') === null, '26: one kept here that becomes a follower leaves the wire, and the server is told it was taken from its post');
  ok(!n.leave('stood:t:8') && taken.length === 1, '26: one somebody else keeps may not be taken: it is not this browser\'s to take');
  ok(!n.leave('stood:t:404'), '26: and one never held is nothing to leave');
  const { net: off } = net({ server: false });
  const alone = new Stand('stood:t:1');
  off.add(alone);
  ok(!off.leave('stood:t:1'), '26: with no server there is no wire to leave');
  // A server of the second wire hears no word for a creature walking off: one kept here on it stays on it.
  const { net: old } = net();
  let speaks = true;
  old.seeding = () => speaks;
  const stoodHere = new Stand('k12');
  old.add(stoodHere);
  old.step(BEAT);
  speaks = false;
  const said: string[] = [];
  old.taken = (id) => said.push(id);
  ok(!old.mayLeave('k12') && !old.leave('k12') && said.length === 0 && old.find('k12') === stoodHere, '26: against a server that would drop the word, a body kept here may not leave the wire, and nothing is said');
  speaks = true;
  ok(old.mayLeave('k12'), '26: against one that hears it, it may');
}

// --- 27: a blow on a creature kept here carries the bolt that struck it ------------------------------------
{
  const { net: n, sent } = net({ keeps: (id) => id !== 'w:1:2' });
  let seeding = true;
  n.seeding = () => seeding;
  const mine = new Stand('w:1:1');
  n.add(mine);
  n.add(new Stand('w:1:2'));
  n.handle({ t: 'npcHurt', i: 'w:1:1', a: 9, at: [1, 1, 1], id: 4, w: 'blaster', d: [0, 3, 4], s: 60, c: 0x00ff00, z: 2 });
  const b = mine.hurts[0]?.bolt;
  ok(!!b && Math.abs(b.dy - 0.6) < 1e-9 && Math.abs(b.dz - 0.8) < 1e-9 && b.speed === 60 && b.color === 0x00ff00 && b.size === 2, `27: the keeper's creature is handed the bolt's own flight, so its blade is asked first (${JSON.stringify(b)})`);
  ok(mine.hurts[0].what === 'blaster', '27: with what struck it');
  n.handle({ t: 'npcHurt', i: 'w:1:1', a: 9, at: [1, 1, 1], id: 4 });
  ok(mine.hurts[1]?.bolt === null, '27: and a blow that was no bolt carries none');
  const bolt: NpcBolt = { dx: 0, dy: 0, dz: 1, speed: 80, color: 0xff0000, size: 1 };
  n.askHit('w:1:2', 5, 0, 0, 0, 'blaster', true, bolt);
  const asked = sent.filter((m) => m.t === 'npcHit').pop() as Record<string, unknown>;
  ok(JSON.stringify(asked.d) === '[0,0,1]' && asked.s === 80 && asked.c === 0xff0000 && asked.z === 1, '27: a blow asked of a keeper carries the bolt\'s flight');
  seeding = false;
  n.askHit('w:1:2', 5, 0, 0, 0, 'blaster', true, bolt);
  ok((sent.filter((m) => m.t === 'npcHit').pop() as Record<string, unknown>).d === undefined, '27: but not to a server that does not speak of it, which would pass the blow on without it');
}

// --- 28: a creature's blow on a player, both ways round ----------------------------------------------------
{
  const { net: n, sent } = net({ keeps: (id) => id !== 'wild:t:3:1' });
  let seeding = true;
  n.seeding = () => seeding;
  const mine = new Stand('wild:t:3:0');
  const yours = new Stand('wild:t:3:1');
  n.addSeen(mine, { x: 0, y: 0, z: 0 }, 0);
  n.addSeen(yours, { x: 0, y: 0, z: 0 }, 0);
  n.step(BEAT);
  ok(n.keepsHere('wild:t:3:0') && !n.keepsHere('wild:t:3:1') && !n.keepsHere(''), '28: this browser knows which of its bodies it keeps');
  ok(n.sayBlow(9, 'wild:t:3:0', 14, 1, 2, 3, 'hull'), '28: a creature kept here that strikes another player says so');
  const said = sent.filter((m) => m.t === 'npcBlow').pop() as Record<string, unknown>;
  ok(said.to === 9 && said.i === 'wild:t:3:0' && said.a === 14 && (said.at as number[]).join() === '1,2,3' && said.w === 'hull', `28: to that player, with the creature, how much, where and what (${JSON.stringify(said)})`);
  ok(!n.sayBlow(9, 'wild:t:3:1', 14, 0, 0, 0), '28: one somebody else keeps is not this browser\'s to strike with');
  ok(!n.sayBlow(0, 'wild:t:3:0', 14, 0, 0, 0) && !n.sayBlow(9, 'wild:t:3:0', 0, 0, 0, 0), '28: nor is a blow on nobody, or one that takes nothing');
  const blows: { a: number; at: number[]; from: unknown; what: string }[] = [];
  n.onBlow = (a, x, y, z, from, what) => blows.push({ a, at: [x, y, z], from, what });
  n.handle({ t: 'npcBlow', id: 6, i: 'wild:t:3:1', a: 11, at: [7, 8, 9], w: 'body' });
  ok(blows.length === 1 && blows[0].a === 11 && blows[0].at.join() === '7,8,9' && blows[0].from === yours && blows[0].what === 'body', '28: a blow said by the keeper lands on this player, from the body here that struck it');
  n.handle({ t: 'npcBlow', id: 6, i: 'wild:t:404', a: 3 });
  ok(blows.length === 2 && blows[1].from === null && blows[1].at.join() === '0,0,0', '28: from a creature this browser has no body for it still lands, from nowhere in particular');
  n.handle({ t: 'npcBlow', id: 6, i: 'wild:t:3:1', a: 0 });
  ok(blows.length === 2, '28: one that takes nothing does nothing');
  n.onBlow = () => {
    throw new Error('between worlds');
  };
  ok(n.handle({ t: 'npcBlow', id: 6, i: 'wild:t:3:1', a: 3 }) === true, '28: and a game that cannot take a blow just now drops it rather than taking the message down');
  seeding = false;
  ok(!n.sayBlow(9, 'wild:t:3:0', 14, 0, 0, 0), '28: with no server that speaks of it, nothing is said');
  ok(n.debug().blowsSent === 1 && n.debug().blowsTaken === 3, '28: and the console counts both ways');
}

// --- 29: the creatures' own shots cross on an allowance of their own ----------------------------------------
{
  const { net: n, tick } = net();
  let seeding = true;
  n.seeding = () => seeding;
  let through = 0;
  for (let i = 0; i < 20; i++) if (n.npcShotDue()) through++;
  ok(through === NPC_TUNE.npcShotsPerSecond, `29: ${NPC_TUNE.npcShotsPerSecond} of their shots cross in a second and the rest are pictures nobody else sees`);
  tick(1);
  ok(n.npcShotDue(), '29: and the next second starts the count again');
  seeding = false;
  ok(!n.npcShotDue(), '29: with no server that speaks of them, none cross');
}

// --- 30: a name somebody else keeps that this browser has no body for ---------------------------------------
{
  const { net: n, tick } = net({ keeps: () => false });
  n.seeding = () => true;
  const asked: string[] = [];
  n.onStranger = (id) => asked.push(id);
  n.handle({ t: 'npcState', id: 5, r: [row({ i: 'wild:t:4:3' }), row({ i: 'k9' })] });
  n.handle({ t: 'npcState', id: 5, r: [row({ i: 'wild:t:4:3' })] });
  ok(asked.join() === 'wild:t:4:3', '30: a lair\'s creature its keeper sent out after this one stood its own is asked for, once, and an admin\'s never');
  tick(NPC_TUNE.strangerEvery + 0.1);
  n.handle({ t: 'npcState', id: 5, r: [row({ i: 'wild:t:4:3' })] });
  ok(asked.length === 2, `30: and asked again after ${NPC_TUNE.strangerEvery} s if it is still not here`);
  n.onStranger = () => {
    throw new Error('no lair here');
  };
  tick(NPC_TUNE.strangerEvery + 0.1);
  n.handle({ t: 'npcState', id: 5, r: [row({ i: 'wild:t:4:3', po: 'crouch', cv: 1, f: 'roll', fd: 'R' })] });
  ok(n.debug().waiting === 2, '30: a wiring that cannot stand it leaves the row parked, beside the admin\'s');
  const late = new Stand('wild:t:4:3');
  n.add(late);
  const got = late.drives[0]?.row;
  ok(got?.po === 'crouch' && got.cv === 1 && got.f === undefined && got.fd === undefined, '30: and a body stood from it later is stood low behind its cover, without the roll it did not see');
}

// --- 31: a driven body is told every mark, posture and cover ------------------------------------------------
{
  const { net: n } = net({ keeps: () => false });
  const yours = new Stand('w:1:2');
  n.add(yours);
  n.handle({ t: 'npcState', id: 5, r: [row({ i: 'w:1:2', f: 'jump', fd: 'F', ff: 1, po: 'kneel', cv: 1 })] });
  const r1 = yours.drives[0]?.row;
  ok(r1?.f === 'jump' && r1.fd === 'F' && r1.ff === 1 && r1.po === 'kneel' && r1.cv === 1, `31: a Force jump forward, kneeling in cover, all arrive (${JSON.stringify(r1)})`);
  n.handle({ t: 'npcState', id: 5, r: [row({ i: 'w:1:2', f: 'hit', fd: 'F', ff: 1 })] });
  const r2 = yours.drives[1]?.row;
  ok(r2?.f === 'hit' && r2.fd === undefined && r2.ff === undefined && r2.po === undefined && r2.cv === undefined, '31: and the next row, a plain blow upright in the open, carries none of the last one\'s');
  // A keeper's own rows are cleared the same way: a pooled row never carries the last body's posture.
  const { net: k, sent } = net();
  const low = new Stand('w:1:3');
  const up = new Stand('w:1:4');
  (low as unknown as { npcFill: (r: NpcRow) => boolean }).npcFill = (r) => {
    Stand.prototype.npcFill.call(low, r);
    r.po = 'prone';
    r.cv = 1;
    return true;
  };
  k.add(low);
  k.step(BEAT);
  k.remove('w:1:3');
  k.add(up);
  k.step(BEAT);
  const last = (sent.filter((m) => m.t === 'npcState').pop() as { r: NpcRow[] }).r[0];
  ok(last.i === 'w:1:4' && last.po === undefined && last.cv === undefined, '31: a keeper\'s pooled row never carries the last body\'s posture to the next');
}

// --- 31b: a seen body still being built is put down, and said again once it can speak -------------------------
{
  const wasKeep = NPC_TUNE.cannotKeepSeconds;
  NPC_TUNE.cannotKeepSeconds = 1;
  const granted = new Set<string>(['stood:t:40']);
  const { net: n, sent, tick } = net({ keeps: (id) => granted.has(id) });
  n.seeding = () => true;
  n.granted = () => granted;
  const said: string[] = [];
  const putDown: string[] = [];
  n.seen = (id) => said.push(id);
  n.unseen = (id) => putDown.push(id);
  const dressing = new Stand('stood:t:40');
  dressing.ready = false;
  n.addSeen(dressing, { x: 0, y: 0, z: 0 }, 60);
  for (let i = 0; i < 8; i++) {
    tick(BEAT);
    n.step(BEAT);
  }
  ok(putDown.join() === 'stood:t:40' && !sent.some((m) => m.t === 'npcDrop'), '31b: a seen body of this browser\'s own that cannot speak yet is put down rather than refused, so it is not kept off for two minutes');
  // The server takes the grant back, as it does for anybody putting a body down.
  granted.delete('stood:t:40');
  for (let i = 0; i < Math.ceil(NPC_TUNE.reseeSeconds / BEAT) + 2; i++) {
    tick(BEAT);
    n.step(BEAT);
  }
  ok(dressing.driven && said.length === 1, '31b: and while it still cannot speak, nothing more is said');
  dressing.ready = true;
  tick(BEAT);
  n.step(BEAT);
  ok(said.length === 2 && said[1] === 'stood:t:40', '31b: the moment it can, it says it has one again, and the server can hand it back');
  NPC_TUNE.cannotKeepSeconds = wasKeep;
}

// --- 32: the world's list on this side: saying seen, and what a seen death means here -------------------
{
  let now = 1000;
  const o = new Owned(() => now);
  const sent: Record<string, unknown>[] = [];
  o.send = (m) => sent.push(JSON.parse(JSON.stringify(m)) as Record<string, unknown>);
  o.authority = () => 'server';
  let seeds = true;
  o.seeds = () => seeds;
  ok(o.seeding, '32: with a server that speaks of them, this browser shares what it stands for itself');
  for (let i = 0; i < 20; i++) o.saySeen(`stood:t:${i}`, { x: i + 0.123, y: 0, z: 0 }, 45.4);
  const first = sent.filter((m) => m.do === 'seen');
  ok(first.length === OWN_TUNE.seenPerSecond && o.debug().seenWaiting === 20 - OWN_TUNE.seenPerSecond, `32: walking into a town says ${OWN_TUNE.seenPerSecond} of them this second, under the server's own allowance, and the rest wait their turn`);
  ok((first[1].at as number[])[0] === 1.12 && first[1].r === 45, '32: each with where it stands, cut to the centimetre, and its respawn in whole seconds');
  o.saySeen('stood:t:19', { x: 9, y: 9, z: 9 }, 45);
  ok(o.debug().seenWaiting === 20 - OWN_TUNE.seenPerSecond, '32: one said again before its turn is still one word');
  o.sayUnseen('stood:t:18');
  ok(o.debug().seenWaiting === 20 - OWN_TUNE.seenPerSecond - 1 && !sent.some((m) => m.do === 'unseen'), '32: one put down before its word went out is simply forgotten: the server never heard of it');
  // A calendar second's edge is not the server's: it counts its second from the first word of a burst, so
  // a flush either side of an edge used to land twice the allowance in one of its seconds, and the words
  // over its twenty were dropped there in silence. The span is measured back from each word sent instead.
  now += 1;
  o.tick();
  ok(sent.filter((m) => m.do === 'seen').length === OWN_TUNE.seenPerSecond, '32: a second later, inside the span, nothing more goes, so no second the server counts ever holds more than the allowance');
  now += OWN_TUNE.seenSpan - 1;
  o.tick();
  const all = sent.filter((m) => m.do === 'seen');
  ok(all.length === 19 && o.debug().seenWaiting === 0, '32: and the rest go once the span is out, on the wiring\'s own clock');
  ok((all.find((m) => m.id === 'stood:t:19')?.at as number[])[0] === 9, '32: with the place it was last said at');
  o.sayUnseen('stood:t:0');
  ok(sent.filter((m) => m.do === 'unseen').length === 1, '32: one put down after its word went out says so');
  o.saySeen('travel:t:1', { x: 0, y: 0, z: 0 }, 0);
  o.saySeen('k4', { x: 0, y: 0, z: 0 }, 0);
  ok(sent.filter((m) => m.do === 'seen').length === 19, '32: a ticket collector or an admin\'s name is never said');
  seeds = false;
  o.saySeen('stood:t:30', { x: 0, y: 0, z: 0 }, 0);
  ok(!o.seeding && sent.filter((m) => m.do === 'seen').length === 19, '32: and with a relay that speaks no such word nothing is said at all');
  seeds = true;

  const gone: { id: string; why: string; back: number }[] = [];
  o.onGone = (id, why, back) => gone.push({ id, why, back });
  o.handle({ t: 'keep', add: ['stood:t:1'], drop: [] });
  ok(o.mine('stood:t:1'), '32: a grant for a seen one is held as any other');
  o.handle({ t: 'spawn', do: 'gone', id: 'stood:t:1', why: 'dead', back: 30, by: [4] });
  ok(gone.length === 1 && gone[0].why === 'dead' && gone[0].back === 30, '32: a seen death is handed on with its respawn, though the list never held it');
  ok(!o.mine('stood:t:1') && o.dead('stood:t:1') && Math.abs(o.downFor('stood:t:1') - 30) < 1e-9, '32: the grant goes with it, and it is down for exactly that long');
  o.handle({ t: 'keep', add: ['stood:t:1'], drop: [] });
  ok(!o.mine('stood:t:1'), '32: a grant crossing the death on the wire does not bring it back');
  now += 31;
  ok(!o.dead('stood:t:1') && o.downFor('stood:t:1') === 0, '32: and once its respawn is out it may stand again, in this browser as in every other');
  o.handle({ t: 'spawn', do: 'gone', id: 'camp:t:2', why: 'taken', back: 60 });
  ok(gone[1]?.why === 'taken' && o.dead('camp:t:2'), '32: one taken from its post leaves it empty for its respawn too');
  o.handle({ t: 'spawn', do: 'gone', id: 'stood:t:3', why: 'dead' });
  ok(o.downFor('stood:t:3') === 1, '32: a seen death with no respawn said is down for a second, never not at all');
  o.handle({ t: 'spawn', do: 'add', row: { id: 'k5', world: 't', species: 'a_trooper', at: [0, 0, 0], h: 0, seed: 1, weapon: 'object/weapon/ranged/rifle/rifle_e11.iff' } });
  ok(o.row('k5')?.weapon === 'object/weapon/ranged/rifle/rifle_e11.iff', '32: an admin\'s creature arrives with the weapon in its hand');
  // The server's world key is the planet and the zone with a NUL between (`roomKey`), and the record is
  // stood only where the key matches this browser's own exactly: stripped of it, every admin's creature
  // was refused everywhere as another world's.
  const key = roomKey('endor', '');
  o.handle({ t: 'spawn', do: 'add', row: { id: 'k8', world: key, species: 'a_trooper', at: [0, 0, 0], h: 0, seed: 1 } });
  ok(o.row('k8')?.world === key && key.includes('\u0000'), '32: a row\'s world key is kept exactly as the server made it, NUL and all');
  o.handle({ t: 'spawn', do: 'add', row: { id: 'k6', world: 't', species: 'a_trooper', at: [0, 0, 0], weapon: '../../x' } });
  ok(o.row('k6') !== null && o.row('k6')?.weapon === undefined, '32: and one whose weapon is not a path stands with none, armed off its own list');
  o.handle({ t: 'spawn', do: 'gone', id: 'k5', why: 'dead' });
  now += 3600;
  ok(o.dead('k5'), '32: an admin\'s that died stays dead for good');

  const local: string[] = [];
  o.onLocal = (id) => local.push(id);
  o.saySeen('wild:t:9:0', { x: 0, y: 0, z: 0 }, 0);
  o.handle({ t: 'spawn', do: 'local', id: 'wild:t:9:0' });
  ok(local.join() === 'wild:t:9:0' && o.debug().local === 1, '32: told the world can hold no more, the body is this browser\'s own to keep');

  o.handle({ t: 'keep', add: ['stood:t:7'], drop: [] });
  o.sayTaken('stood:t:7');
  o.sayTaken('stood:t:8');
  ok(sent.filter((m) => m.do === 'taken').map((m) => m.id).join() === 'stood:t:7', '32: only one this browser keeps may be said to have walked off');
  o.handle({ t: 'keep', add: ['stood:t:9'], drop: [] });
  o.sayDead('stood:t:9', [4, 9]);
  ok(JSON.stringify(sent.filter((m) => m.do === 'dead').pop()?.by) === '[4,9]', '32: a death this browser keeps names who struck it');
  seeds = false;
  o.handle({ t: 'keep', add: ['k7'], drop: [] });
  o.sayDead('k7', [4]);
  ok((sent.filter((m) => m.do === 'dead').pop() as Record<string, unknown>).by === undefined, '32: but not to a relay that would only drop the field');
  seeds = true;
  ok(/admin/.test(o.askSpawn('a_trooper', [0, 0, 0], 0, 0, '', false, 'object/weapon/ranged/rifle/rifle_e11.iff')) && !sent.some((m) => m.do === 'add'), '32: anybody but the admin asking to stand one armed is told whose it is, and nothing goes out');
  o.admin = () => true;
  o.askSpawn('a_trooper', [0, 0, 0], 0, 0, '', false, 'object/weapon/ranged/rifle/rifle_e11.iff');
  ok((sent.filter((m) => m.do === 'add').pop() as Record<string, unknown>)?.weapon === 'object/weapon/ranged/rifle/rifle_e11.iff', '32: the admin asking for one with a weapon sends it in the ask');
  const d = o.debug();
  ok(d.seeding && d.seen === 20 && d.unseen === 1 && d.local === 1 && typeof d.keptSeen === 'number' && typeof d.seenDown === 'number', `32: the console reads all of it (${JSON.stringify({ seen: d.seen, unseen: d.unseen, local: d.local, keptSeen: d.keptSeen, keptStood: d.keptStood, seenDown: d.seenDown })})`);

  // A walk-off, and the answer about a body only just stood, are both words of the third wire.
  o.handle({ t: 'keep', add: ['stood:t:31'], drop: [] });
  seeds = false;
  o.sayTaken('stood:t:31');
  ok(!sent.some((m) => m.do === 'taken' && m.id === 'stood:t:31'), '32: nothing is said to walk off to a relay that would drop the word, leaving every other screen a frozen copy');
  seeds = true;
  const fresh: boolean[] = [];
  o.onGone = (_id, _why, _back, f) => fresh.push(f);
  o.handle({ t: 'spawn', do: 'gone', id: 'wild:t:31:0', why: 'dead', back: 10, fresh: 1 });
  o.handle({ t: 'spawn', do: 'gone', id: 'wild:t:31:1', why: 'dead', back: 10 });
  ok(fresh.join() === 'true,false' && o.dead('wild:t:31:0'), '32: the server\'s answer about a body only just stood says so, and is down all the same');
}

// --- 33: a body put down says so, and a body that died here says that ------------------------------------------
{
  // The game's own bodies go off the wire before they are marked dead (`Mobile.dispose`). Marked first,
  // every lair creature and every person put down was taken for a death: nothing told the server this
  // browser had no body for it any more, and the creature froze on every other screen.
  const { net: n, sent, tick } = net();
  n.seeding = () => true;
  n.selfId = () => 4;
  const putDown: string[] = [];
  n.unseen = (id) => putDown.push(id);
  const deaths: { id: string; by: number[] }[] = [];
  n.died = (id, by) => {
    deaths.push({ id, by: [...by] });
    return true;
  };
  const walked = new Stand('wild:t:20:0');
  n.addSeen(walked, { x: 0, y: 0, z: 0 }, 30);
  n.step(BEAT);
  n.remove('wild:t:20:0');
  walked.npcDead = true;
  ok(putDown.join() === 'wild:t:20:0' && deaths.length === 0, '33: a body put down alive says it has none any more, and dies nowhere');
  const fell = new Stand('wild:t:20:1');
  n.addSeen(fell, { x: 0, y: 0, z: 0 }, 30);
  n.step(BEAT);
  fell.struck = [PLAYER_KEY];
  fell.npcDead = true;
  n.remove('wild:t:20:1');
  ok(deaths.length === 1 && deaths[0].id === 'wild:t:20:1' && deaths[0].by.join() === '4' && putDown.length === 1, '33: one that died here and went before the next batch reached it has its death said as it goes, naming who struck it, and is not said to be put down');
  const lay = new Stand('wild:t:20:2');
  n.addSeen(lay, { x: 0, y: 0, z: 0 }, 30);
  n.step(BEAT);
  lay.npcDead = true;
  tick(BEAT);
  n.step(BEAT);
  n.remove('wild:t:20:2');
  ok(deaths.length === 2 && putDown.length === 1, '33: one whose death the batch already said goes saying nothing more');
  const ended = new Stand('wild:t:20:3');
  n.addSeen(ended, { x: 0, y: 0, z: 0 }, 30);
  n.step(BEAT);
  n.noteGone('wild:t:20:3', 'gone');
  n.remove('wild:t:20:3');
  ok(putDown.length === 1 && deaths.length === 2 && !sent.some((m) => m.t === 'npcGone'), '33: nor one the world took away, which it already knows');
  // The order is the game's to keep, so it is pinned where the bodies are put down.
  const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const bodyOf = (text: string, head: string) => {
    const at = text.indexOf(head);
    return at < 0 ? '' : text.slice(at, text.indexOf('\n  }\n', at));
  };
  const mobileDispose = bodyOf(src('../../../src/world/mobiles/mobile.ts'), '\n  dispose(): void {');
  ok(mobileDispose.indexOf('net.remove(this.shared)') > 0 && mobileDispose.indexOf('net.remove(this.shared)') < mobileDispose.indexOf('this.dead = true'), '33: a mobile goes off the wire before it is marked dead');
  const fighterDispose = bodyOf(src('../../../src/world/npcs.ts'), '\n  dispose(scene: THREE.Scene): void {');
  ok(fighterDispose.indexOf('net.remove(this.shared)') > 0 && fighterDispose.indexOf('net.remove(this.shared)') < fighterDispose.indexOf('this.dead = true'), '33: and so does a fighter');
}

// --- 34: another player is fought only by a body whose blow can reach them -------------------------------------
{
  const { net: n } = net({ keeps: (id) => id === 'wild:t:21:0' });
  n.seeding = () => true;
  n.addSeen(new Stand('wild:t:21:0'), { x: 0, y: 0, z: 0 }, 0);
  n.addSeen(new Stand('wild:t:21:1'), { x: 0, y: 0, z: 0 }, 0);
  n.step(BEAT);
  const peer = { isPeer: true };
  ok(mayFight(peer, 'wild:t:21:0', n), '34: a body kept here on the wire may go after another player: its blow crosses to their browser');
  ok(!mayFight(peer, 'wild:t:21:1', n) && !mayFight(peer, '', n) && !mayFight(peer, 'stood:t:404', n), '34: one driven from elsewhere, one off the wire and one never held may not: they would chase a picture they can never finish');
  ok(mayFight({}, '', n) && mayFight({ isPeer: false }, '', null), '34: anything that is not another player is anybody\'s to fight');
  const { net: off } = net({ server: false });
  ok(!mayFight(peer, 'wild:t:21:0', off), '34: and with no server nobody may go after one at all');
  const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  ok(/if \(!mayFight\(t, this\.shared\)\) continue;/.test(src('../../../src/world/mobiles/mobile.ts')) && /if \(!mayFight\(t, this\.shared\)\) continue;/.test(src('../../../src/world/npcs.ts')), '34: both kinds of body ask it of every living thing they think about');
  ok(/readonly isPeer = true;/.test(src('../../../src/net/remoteBodies.ts')), '34: and another player\'s figure says what it is');
}

// --- 35: who struck a body is kept apart from its brain -----------------------------------------------------------
{
  const s = new Strikers();
  const out: number[] = [];
  s.note(PLAYER_KEY, 10);
  s.note(55, 11);
  s.note(PLAYER_KEY, 12);
  s.within(13, 8, out);
  ok(out.join() === `${PLAYER_KEY},55`, `35: each striker once, whatever the order (${out.join()})`);
  s.within(19.5, 8, out);
  ok(out.join() === `${PLAYER_KEY}`, '35: and only those inside the window');
  for (let k = 0; k < STRIKER_SLOTS + 3; k++) s.note(100 + k, 20 + k);
  s.within(40, 100, out);
  ok(out.length === STRIKER_SLOTS && !out.includes(PLAYER_KEY) && out.includes(100 + STRIKER_SLOTS + 2), '35: full, the oldest gives way to the newest');
  s.note(0, 50);
  s.clear();
  s.within(50, 100, out);
  ok(out.length === 0, '35: nobody is ever key nought, and a fresh life has nobody');
  const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const mobile = src('../../../src/world/mobiles/mobile.ts');
  const fighter = src('../../../src/world/npcs.ts');
  ok(/this\.strikers\.note\(source\.key, this\.now\);/.test(mobile) && /this\.strikers\.within\(this\.now, seconds, out\);/.test(mobile), '35: a mobile notes every striker, passive or not, and its death reads them from there');
  ok(/this\.strikers\.note\(source\.key, this\.now\);/.test(fighter) && /this\.strikers\.within\(this\.now, seconds, out\);/.test(fighter), '35: and a fighter, whose brain forgets everything the moment it dies');
}

// --- 36: the bodies themselves write and play everything a row carries --------------------------------------------
{
  // Neither kind of body loads under node, so what they say and what they do with what they are told is
  // pinned in their own words: rows with nothing in them would pass every other check here.
  const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const [who, text, low, cover, drive] of [
    ['mobile', src('../../../src/world/mobiles/mobile.ts'), /if \(this\.posture !== 'stand'\) row\.po = this\.posture;/, /if \(tac\?\.coverKind && tac\.inSpot\(this\.pos\.x, this\.pos\.z\)\) row\.cv = 1;/, /if \(low !== this\.posture && this\.lowClips && !this\.tumbling\) this\.drivenPosture\(low\);\s*if \(row\.f\) this\.sawMark\(row\.f, row\.fd, row\.ff === 1\);/],
    ['fighter', src('../../../src/world/npcs.ts'), /if \(this\.posture !== 'stand'\) row\.po = this\.posture as NpcLow;/, /<= FIGHTER_TUNE\.arrive\) row\.cv = 1;/, /if \(row\.f\) this\.sawMark\(row\.f, row\.fd \?\? 'F', row\.ff === 1\);/],
  ] as const) {
    ok(/if \(this\.mark === 'roll' \|\| this\.mark === 'jump'\) row\.fd = this\.markDir;\s*if \(this\.mark === 'jump' && this\.markForce\) row\.ff = 1;\s*this\.mark = null;/.test(text), `36: a ${who}'s row says which way it rolled or jumped and whether the jump was the Force's`);
    ok(low.test(text) && cover.test(text), `36: and how low it stands and whether it is in its cover`);
    ok(/this\.mark = 'roll';\s*this\.markDir = dir;/.test(text) && /this\.mark = 'jump';\s*this\.markDir = dir;\s*this\.markForce = /.test(text) && /this\.mark = 'block';/.test(text), `36: a ${who}'s roll, jump and parry each leave their mark for the next batch`);
    ok(drive.test(text), `36: a driven ${who} takes the posture and plays the mark it is told`);
    ok(/if \(mark === 'roll'\) \{/.test(text) && /if \(mark === 'jump'\) \{/.test(text) && /if \(mark === 'block'\) \{/.test(text), `36: and has a clip for a roll, a jump and a parry`);
  }
  const mobile = src('../../../src/world/mobiles/mobile.ts');
  ok(/if \(!this\.mark\) this\.mark = 'hit';/.test(mobile), '36: a flinch never writes over a roll, a jump or a parry waiting for the batch');
  // The deflection's chain: the shooter's copy holds the bolt and asks the keeper with it; the keeper's
  // blade answers, marks the parry and flies the bolt back as its own.
  ok(/this\.heldBoltAt = this\.now;/.test(mobile) && /const bolt = this\.heldBoltAt === this\.now \? this\.heldBolt : null;[\s\S]{0,1200}askHit\(this\.shared, amount, [^)]*, bolt\)\) return;/.test(mobile), '36: a driven copy hands the keeper the bolt that struck it');
  ok(/if \(this\.blockFrom\(blockDir, blowFrom, blockOut\)\) \{\s*this\.mark = 'block';[\s\S]{0,400}this\.deps\.bolts\.fire\(/.test(mobile), '36: and the keeper\'s blade turns it away, marks the parry and flies a bolt back');
  const fighter = src('../../../src/world/npcs.ts');
  ok(/const bolt = this\.heldBoltAt === this\.now \? this\.heldBolt : null;[\s\S]{0,400}askHit\(this\.shared, amount, [^)]*, bolt\)\) return;/.test(fighter) && /if \(this\.blockFrom\(tmp2, tmp, tmp3\)\) \{\s*this\.mark = 'block';[\s\S]{0,400}this\.boltsNow\?\.fire\(/.test(fighter), '36: a fighter the same, both ways');
  const bolts = src('../../../src/combat/bolts.ts');
  ok(/if \(b\.wire\) this\.onGone\?\.\(b, hitPoint\);[\s\S]{0,1400}this\.onFire\?\.\(b\);/.test(bolts), '36: a wired bolt a creature\'s blade turned away here ends every picture at the blade and flies back as a shot that crosses');
  ok(/if \(wired\) this\.onGone\?\.\(b, hitPoint\);[\s\S]{0,900}if \(wired\) this\.onFire\?\.\(b\);/.test(bolts), '36: and so does one of this browser\'s own creatures\' shots that the player\'s own blade turned away');
}

// --- 37: the admin arming one already standing, this side's half ----------------------------------------
// The console's `arm` with a server asks and arms nothing itself: the server's word comes back to every
// browser on the world, this one included, and that is what re-arms every copy alike.
{
  const o = new Owned(() => 5000);
  const sent: Record<string, unknown>[] = [];
  o.send = (m) => sent.push(JSON.parse(JSON.stringify(m)) as Record<string, unknown>);
  ok(o.askArm('k1', 'object/weapon/x.iff') === '' && sent.length === 0, '37: with no server it asks nothing (a body is armed here, and only here)');
  o.authority = () => 'server';
  ok(/admin/.test(o.askArm('k1', 'object/weapon/x.iff')) && sent.length === 0, '37: with a server only the world’s admin may arm one of its creatures');
  o.admin = () => true;
  ok(/older/.test(o.askArm('k1', 'object/weapon/x.iff')) && sent.length === 0, '37: and only on a server that hears the word, or the admin would be left looking at a body that never changed hands');
  o.arms = () => true;
  ok(o.askArm('k1', 'object/weapon/x.iff') === '' && sent.length === 1 && sent[0].do === 'arm' && sent[0].id === 'k1' && sent[0].weapon === 'object/weapon/x.iff', '37: the admin’s ask names the body and the weapon’s template');
  const heard: [string, string][] = [];
  o.onArm = (id, weapon) => heard.push([id, weapon]);
  o.handle({ t: 'spawn', do: 'add', row: { id: 'k1', world: 'tatooine\u0000', species: 'some_body', at: [0, 0, 0], h: 0, seed: 3 } });
  o.handle({ t: 'spawn', do: 'arm', id: 'k1', weapon: 'object/weapon/x.iff' });
  ok(heard.length === 1 && heard[0][0] === 'k1' && heard[0][1] === 'object/weapon/x.iff', '37: the server’s word is handed to whoever re-arms the body');
  ok(o.row('k1')?.weapon === 'object/weapon/x.iff', '37: and the row remembers it, so the body is stood holding it again from that row');
  o.handle({ t: 'spawn', do: 'arm', id: 'k1', weapon: '../../x' });
  o.handle({ t: 'spawn', do: 'arm', id: '__proto__', weapon: 'object/weapon/x.iff' });
  ok(heard.length === 1, '37: a word with a path that climbs out of where it is looked up, or a name that is not one, is dropped');
}

console.log(`\n${checks} checks passed`);
