// What a character owns and how two players hand something over (server/ledger.mjs). The one thing
// every check below is really about: an item may never be duplicated and may never be lost. So every
// trade counts the rows before and after, the world is written through the store's own `applyChange`
// so that a second ledger can be built from it as a restart would, and every way a trade can end
// badly ends with the items exactly where they started. Synthetic players only; no sockets and no
// clock but the one handed in. (The places two players can both want are spots.mjs and its own test.)
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ITEMS_VERSION, LEDGER_TUNING, Ledger, applyItems, cleanItemId, cleanItems, cleanThing, cleanTintSet, cleanTrade, mayItems } from '../../../server/ledger.mjs';
import { applyChange, emptyWorld, openStore } from '../../../server/store.mjs';
import { GROUP_RANGES } from '../../../server/groups.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type Tell = { to: number; msg: any };
type Result = { ok: boolean; why?: string; tell: Tell[]; take?: string; rows?: any[]; moved?: number };

/**
 * A server with its own clock, its own world on disk and its own postbox. Every change the ledger
 * decides to write goes through the store's own `applyChange`, exactly as the relay wires it, so what
 * the tests read back is what a restart would read back; every line it decides to send is kept
 * against the connection it was sent to, as the relay would fan it out.
 */
function server(tuning: Record<string, number> = {}) {
  let t = 100000;
  const world: any = emptyWorld(t);
  const log: any[] = [];
  /** What the row a write is about looked like at the instant the record was written. */
  const atWrite: { owner: string }[] = [];
  let ledger: any = null;
  /** Something to do at the instant a record is written, which is before anybody has been told. */
  let atRecord: ((rec: any) => void) | null = null;
  /** Whether each record was written lazily (in the log in its place, flushed with the next that is not). */
  const lazy: boolean[] = [];
  const write = (rec: any, isLazy?: boolean) => {
    log.push(rec);
    lazy.push(!!isLazy);
    if (rec.t === 'itemMove') for (const m of rec.moves) atWrite.push({ owner: ledger.rows.get(m.id)?.owner ?? '' });
    applyChange(world, rec);
    if (atRecord) atRecord(rec);
  };
  // The world's birth is handed in as the relay hands in its store's, so the names the server gives
  // things itself are the ones a restart works out on read.
  ledger = new Ledger({ now: () => t, tuning: { ...LEDGER_TUNING, ...tuning }, write, epoch: world.epoch });
  const inbox = new Map<number, any[]>();
  const post = (r: Result) => {
    for (const line of r.tell ?? []) inbox.set(line.to, [...(inbox.get(line.to) ?? []), line.msg]);
    return r;
  };
  return {
    ledger,
    world,
    log,
    lazy,
    atWrite,
    /** Everything a connection has been sent since the postbox was last emptied. */
    to: (session: number) => inbox.get(session) ?? [],
    /** The last thing a connection was sent, which is what its window would be showing. */
    last: (session: number) => (inbox.get(session) ?? [])[(inbox.get(session) ?? []).length - 1],
    clear: () => inbox.clear(),
    /** Have something happen in the middle of a write: a line dropping, say. Null puts it back. */
    onWrite: (fn: ((rec: any) => void) | null) => {
      atRecord = fn;
    },
    now: () => t,
    wait(ms: number) {
      t += ms;
      post(ledger.tick() as Result);
    },
    do: (r: Result) => post(r),
    /** How many rows the world on disk holds, which is the number that may never move by itself. */
    rowsOnDisk: () => Object.keys(world.items).length,
    /** Who owns what on disk, as `kind:what` to the character holding it. */
    ownersOnDisk() {
      const out = new Map<string, string>();
      for (const id of Object.keys(world.items)) {
        const row = world.items[id];
        out.set(`${row.kind}:${row.what}`, row.owner);
      }
      return out;
    },
    /** The ledger a restart would build: the world read back with nothing else carried over. */
    restart: () => new Ledger({ now: () => t, tuning: { ...LEDGER_TUNING, ...tuning }, write }).load(world),
  };
}

/** Two players standing next to each other, each with a backpack the server now holds. */
function pair(s: ReturnType<typeof server>, mine: string[] = ['shirt_s03'], theirs: string[] = ['pistol_cdef']) {
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  s.do(s.ledger.here('c.ben', { session: 2, name: 'Ben' }) as Result);
  s.do(s.ledger.settle('c.ann', mine.map((what) => ({ kind: 'wear', what, got: 10 }))) as Result);
  s.do(s.ledger.settle('c.ben', theirs.map((what) => ({ kind: 'weapon', what, got: 20 }))) as Result);
  return {
    ann: s.ledger.listFor('c.ann'),
    ben: s.ledger.listFor('c.ben'),
  };
}

/** Both sides say they are happy, one after the other, standing next to each other. */
function swap(s: ReturnType<typeof server>, annRows: string[], benRows: string[]) {
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', annRows) as Result);
  s.do(s.ledger.offer('c.ben', benRows) as Result);
  s.do(s.ledger.ready('c.ann', 2) as Result);
  return s.do(s.ledger.ready('c.ben', 2) as Result);
}

// --- 1: what a browser may send ---------------------------------------------------------------------
{
  const list = cleanItems({ t: 'items', do: 'list', rows: [{ kind: 'wear', what: 'shirt_s03', got: 5 }, { kind: 'weapon', what: 'pistol_cdef' }] });
  ok(list?.do === 'list' && list.rows.length === 2 && list.rows[0].what === 'shirt_s03', '1: a backpack handed up is a kind and an id per line');
  ok(cleanItems({ t: 'items', do: 'list', rows: [{ kind: 'house', what: 'x' }, { kind: 'wear' }, { kind: 'wear', what: '__proto__' }] })?.rows.length === 0, '1: a pack nobody has, a line with nothing in it, and a name that means something to every object are each left out');
  ok(cleanItems({ t: 'items', do: 'add', kind: 'wear', what: 'shirt_s03' })?.what === 'shirt_s03', '1: something coming into a character\'s hands names what it is');
  ok(cleanItems({ t: 'items', do: 'drop' }) === undefined && cleanItems({ t: 'items', do: 'burn', id: 'i1' }) === undefined, '1: dropping nothing, and a word nobody knows, are dropped whole');
  const using = cleanItems({ t: 'items', do: 'using', worn: ['i1', 'i1', 'bad id'], held: ['i2'] });
  ok(using?.worn.length === 1 && using.held[0] === 'i2', '1: what is on the body is a list of rows with the repeats and the nonsense taken out');
  ok(cleanItems(null) === undefined && cleanItems([1] as unknown as object) === undefined, '1: nothing at all and a list are not messages about items');
  ok(cleanTrade({ t: 'trade', do: 'ask', to: 4 })?.to === 4 && cleanTrade({ t: 'trade', do: 'ask', to: -1 }) === undefined, '1: asking names the connection the browser already knows them by, and nothing else will do');
  ok(cleanTrade({ t: 'trade', do: 'offer', rows: ['i1', 'i2'] })?.rows.length === 2 && cleanTrade({ t: 'trade', do: 'offer' })?.rows.length === 0, '1: an offer is the whole of this side\'s pane, and an empty pane is a real offer');
  ok(cleanTrade({ t: 'trade', do: 'offer', rows: new Array(200).fill('i1') })?.rows.length === 1, '1: and a pane far bigger than the window is cut to what it may hold');
  ok(cleanTrade({ t: 'trade', do: 'steal' }) === undefined, '1: there is no step by that name');
  ok(cleanItemId('i12') === 'i12' && cleanItemId('a b') === '' && cleanItemId('x'.repeat(200)) === '', '1: an id is plain, short and nothing else');
  const window = { at: 0, lines: 0 };
  let through = 0;
  for (let i = 0; i < 20; i++) if (mayItems(window, 5000)) through++;
  ok(through === LEDGER_TUNING['ask.perSecond'], `1: one browser may send ${LEDGER_TUNING['ask.perSecond']} words about its things in a second and the rest are dropped`);
  ok(mayItems(window, 6000) === true, '1: and the next second starts the count again');
}

// --- 2: the first list is written down, and after that the server's is the truth ------------------------
{
  const s = server();
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  const first = s.do(s.ledger.settle('c.ann', [{ kind: 'wear', what: 'shirt_s03', got: 10 }, { kind: 'weapon', what: 'pistol_cdef', got: 11 }]) as Result);
  ok(first.take === 'browser' && first.rows?.length === 2, '2: a character the server has never held hands its backpack up and that is the list');
  ok(s.rowsOnDisk() === 2 && s.world.characters['c.ann'].items === 1, '2: it is written down, and the character\'s own record says the server holds it now');
  ok(s.log.filter((r) => r.t === 'itemSet').length === 1 && s.log.filter((r) => r.t === 'item').length === 0, '2: and a whole backpack is one line in the log rather than one line a thing, so a full one is one flush on the read path and a crash in the middle of it cannot leave half a list');
  ok(first.rows?.every((r: any) => typeof r.id === 'string' && r.id), '2: every row comes back with the id the server minted, which is how a browser names one again');
  const again = s.do(s.ledger.settle('c.ann', [{ kind: 'wear', what: 'robe_jedi_padawan', got: 12 }]) as Result);
  ok(again.take === 'server' && again.rows?.length === 2 && s.rowsOnDisk() === 2, '2: a browser whose list disagrees is told the server\'s rather than merged with, so nothing it brings can put back what it gave away');
  ok(s.ledger.rowFor('c.ann', 'wear', 'robe_jedi_padawan') === null, '2: and what it brought the second time is not there at all');
  const cleared = s.do(s.ledger.settle('c.ann', []) as Result);
  ok(cleared.take === 'server' && cleared.rows?.length === 2 && s.rowsOnDisk() === 2, '2: a browser whose storage was cleared asks with nothing and is handed everything back');
  ok(s.ledger.add('c.ann', 'wear', 'shirt_s03').already === true && s.rowsOnDisk() === 2, '2: a second of something a character already has is not a second row');
  const more = s.ledger.add('c.ann', 'wear', 'boots_s03', 13);
  ok(more.ok === true && s.rowsOnDisk() === 3, '2: and something new is');
  s.ledger.drop('c.ann', more.row.id);
  ok(s.rowsOnDisk() === 2 && s.ledger.listFor('c.ann').length === 2, '2: destroying one takes it off the disk as well as out of the backpack');
}

// --- 3: a trade, both ways ------------------------------------------------------------------------------
{
  const s = server();
  const held = pair(s);
  const before = s.rowsOnDisk();
  ok(before === 2, '3: two players, one thing each');
  s.clear();
  const done = swap(s, [held.ann[0].id], [held.ben[0].id]) as Result;
  ok(done.ok === true && done.moved === 2, '3: both sides say they are happy and both rows move');
  ok(s.rowsOnDisk() === before, '3: the world holds exactly as many things after the swap as before it');
  const owners = s.ownersOnDisk();
  ok(owners.get('wear:shirt_s03') === 'c.ben' && owners.get('weapon:pistol_cdef') === 'c.ann', '3: and each thing is written down under whoever has it now');
  ok(s.ledger.listFor('c.ann').length === 1 && s.ledger.listFor('c.ben').length === 1, '3: neither backpack has grown or shrunk');
  const moves = s.log.filter((r) => r.t === 'itemMove');
  ok(moves.length === 1 && moves[0].moves.length === 2, '3: the hand-over is one line in the log with both rows in it, so a power cut in the middle of it leaves both moved or neither');
  ok(s.atWrite.length === 2 && s.atWrite[0].owner === 'c.ann' && s.atWrite[1].owner === 'c.ben', '3: and that line is written before anything in memory has moved, let alone before either browser is told');
  const told = [s.last(1), s.last(2)];
  ok(told[0]?.do === 'done' && told[1]?.do === 'done', '3: both sides are told, each from its own end');
  ok(told[0].gave[0].what === 'shirt_s03' && told[0].got[0].what === 'pistol_cdef', '3: what you gave and what you got, in the words of your own side');
  const back = s.restart();
  ok(back.listFor('c.ann').length === 1 && back.listFor('c.ann')[0].what === 'pistol_cdef', '3: and a server started again reads the same answer off the disk');
  ok(back.holds('c.ann') === true && back.holds('c.ben') === true, '3: including that it is the one holding these lists');
}

// --- 4: a one-sided trade, and an empty pane -------------------------------------------------------------
{
  const s = server();
  const held = pair(s);
  swap(s, [held.ann[0].id], []);
  ok(s.rowsOnDisk() === 2 && s.ownersOnDisk().get('wear:shirt_s03') === 'c.ben', '4: a gift is a trade with an empty pane on one side, and it hands over exactly one thing');
  ok(s.ledger.listFor('c.ann').length === 0 && s.ledger.listFor('c.ben').length === 2, '4: one backpack empties and the other has both');
  const lines = s.log.length;
  const nothing = swap(s, [], []) as Result;
  ok(nothing.ok === true && nothing.moved === 0 && s.log.length === lines, '4: two who press with nothing in either pane have agreed to nothing, and nothing at all is written: a record that moves no row would be a flush and a line in the log for a press of a button');
  ok(s.ledger.tradeOf('c.ann') === null, '4: and the window closes all the same');
}

// --- 5: both browsers pull the plug in the middle -----------------------------------------------------------
{
  const s = server();
  const held = pair(s);
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', [held.ann[0].id]) as Result);
  s.do(s.ledger.offer('c.ben', [held.ben[0].id]) as Result);
  s.do(s.ledger.ready('c.ann', 2) as Result);
  s.clear();
  s.do(s.ledger.gone(1) as Result);
  s.do(s.ledger.gone(2) as Result);
  ok(s.ledger.tradeOf('c.ann') === null && s.ledger.tradeOf('c.ben') === null, '5: both lines dropping in the middle of a trade ends it');
  ok(s.rowsOnDisk() === 2, '5: with nothing written and nothing lost');
  const owners = s.ownersOnDisk();
  ok(owners.get('wear:shirt_s03') === 'c.ann' && owners.get('weapon:pistol_cdef') === 'c.ben', '5: and both things exactly where they started, one of them already sworn to and the other not');
  const back = s.restart();
  ok(back.listFor('c.ann').length === 1 && back.listFor('c.ben').length === 1, '5: which is what a server started again says too');
}

// --- 6: the giver's line drops after the server has taken the item and before the taker hears ---------------
{
  const s = server();
  const held = pair(s);
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', [held.ann[0].id]) as Result);
  s.do(s.ledger.offer('c.ben', [held.ben[0].id]) as Result);
  s.do(s.ledger.ready('c.ann', 2) as Result);
  s.clear();
  // The giver's line dies in the very instant the record is written: the world already says the item
  // has changed hands and neither browser has been told a word yet.
  s.onWrite((rec: any) => {
    if (rec.t === 'itemMove') s.do(s.ledger.gone(1) as Result);
  });
  const done = s.do(s.ledger.ready('c.ben', 2) as Result);
  s.onWrite(null);
  ok(done.ok === true && done.moved === 2, '6: a line dropping between the record and the telling does not undo a hand-over that has been decided');
  ok(s.to(1).length === 0, '6: the giver, whose line is already gone, is told nothing at all');
  ok(s.last(2)?.do === 'done' && s.last(2)?.got[0].what === 'shirt_s03', '6: and the taker is told the whole of it, since the item is already theirs on the disk');
  ok(s.ownersOnDisk().get('wear:shirt_s03') === 'c.ben', '6: which is what the world says as well');
  s.do(s.ledger.gone(2) as Result);
  const back = s.restart();
  ok(back.size === 2, '6: a line dropping the instant after the swap was written changes nothing: the world still holds two things');
  ok(back.rowFor('c.ben', 'wear', 'shirt_s03') !== null && back.rowFor('c.ann', 'weapon', 'pistol_cdef') !== null, '6: and both of them are under the name they were handed to, because the log had it before anybody was told');
  ok(back.rowFor('c.ann', 'wear', 'shirt_s03') === null, '6: the giver does not still have it as well, which is the one thing that must never happen');
  // The giver comes back with the browser it had before the trade, still listing what it gave away.
  s.do(back.here('c.ann', { session: 5, name: 'Ann' }) as Result);
  const settled = s.do(back.settle('c.ann', [{ kind: 'wear', what: 'shirt_s03', got: 10 }]) as Result);
  ok(settled.take === 'server' && settled.rows?.length === 1 && settled.rows[0].what === 'pistol_cdef', '6: and a browser that reconnects still holding the old picture is told the truth rather than merged with');
  ok(Object.keys(s.world.items).length === 2, '6: so the thing it gave away is not made a second time');
}

// --- 7: the same character opened in a second browser, mid-trade ---------------------------------------------
{
  const s = server();
  const held = pair(s);
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', [held.ann[0].id]) as Result);
  s.clear();
  s.do(s.ledger.here('c.ann', { session: 7, name: 'Ann' }) as Result);
  ok(s.ledger.tradeOf('c.ann') === null && s.ledger.tradeOf('c.ben') === null, '7: the same character opened in another browser breaks the trade off rather than leaving two windows over one backpack');
  ok(s.to(2).some((m: any) => m.do === 'off'), '7: and the other player is told why, rather than being left looking at a pane that can no longer be given');
  ok(s.rowsOnDisk() === 2 && s.ownersOnDisk().get('wear:shirt_s03') === 'c.ann', '7: with the items where they started');
  ok(s.ledger.sessionOf('c.ann') === 7, '7: the newer line is the one the character is on from that instant');
  s.do(s.ledger.gone(1) as Result);
  ok(s.ledger.sessionOf('c.ann') === 7, '7: and the older line closing a moment later takes nothing with it');
}

// --- 7b: one line puts a character down and picks up another ---------------------------------------------------
{
  const s = server();
  const held = pair(s);
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', [held.ann[0].id]) as Result);
  s.clear();
  // The same browser goes back to the select screen and plays somebody else on the same line.
  s.do(s.ledger.here('c.cal', { session: 1, name: 'Cal' }) as Result);
  ok(s.ledger.characterOf(1) === 'c.cal' && s.ledger.sessionOf('c.ann') === 0, '7b: the character that line was playing is let go rather than left standing here on a live line');
  ok(s.ledger.tradeOf('c.ann') === null && s.ledger.tradeOf('c.ben') === null, '7b: and its window goes with it, so the other side cannot press through onto a backpack nobody is watching');
  ok(s.to(2).some((m: any) => m.do === 'off'), '7b: the other player is told, as they are for every other way a trade ends');
  ok(s.to(1).every((m: any) => m.do !== 'off'), '7b: and the line itself is not sent a word about a window it has already closed, which would now reach a browser playing somebody else');
  ok(s.rowsOnDisk() === 2 && s.ownersOnDisk().get('wear:shirt_s03') === 'c.ann', '7b: with the items where they started');
  s.do(s.ledger.gone(1) as Result);
  ok(s.ledger.sessionOf('c.ann') === 0 && s.ledger.listFor('c.ann').length === 1, '7b: that line closing afterwards changes nothing, and what the character owns is untouched by any of it');
}

// --- 8: two trades of the same item at once, and one of something being worn ------------------------------------
{
  const s = server();
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  s.do(s.ledger.here('c.ben', { session: 2, name: 'Ben' }) as Result);
  s.do(s.ledger.here('c.cal', { session: 3, name: 'Cal' }) as Result);
  s.do(s.ledger.settle('c.ann', [{ kind: 'wear', what: 'shirt_s03', got: 1 }, { kind: 'weapon', what: 'sword_lightsaber_training', got: 2 }]) as Result);
  s.do(s.ledger.settle('c.ben', []) as Result);
  s.do(s.ledger.settle('c.cal', []) as Result);
  const mine = s.ledger.listFor('c.ann');
  const shirt = mine.find((r: any) => r.what === 'shirt_s03').id;
  const saber = mine.find((r: any) => r.what === 'sword_lightsaber_training').id;
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', [shirt]) as Result);
  s.clear();
  ok((s.do(s.ledger.ask('c.ann', 'c.cal', 2) as Result)).ok === false, '8: one player is in one trade at a time, so the same thing cannot be put up in two');
  ok((s.do(s.ledger.ask('c.cal', 'c.ann', 2) as Result)).ok === false && s.to(3).some((m: any) => m.do === 'refused'), '8: and somebody asking them is told so rather than left waiting');
  s.do(s.ledger.using('c.ann', [], [saber]) as Result);
  s.clear();
  const held = s.do(s.ledger.offer('c.ann', [shirt, saber]) as Result);
  ok(held.ok === false && s.to(1).some((m: any) => /holding/.test(m.why ?? '')), '8: something in a hand cannot be put up, and the pane is refused with a word rather than quietly missing a line');
  ok(s.ledger.tradeOf('c.ann').offers.get('c.ann').length === 1, '8: the pane stands as it was: a refusal changes nothing');
  s.do(s.ledger.using('c.ann', [shirt], []) as Result);
  const worn = s.do(s.ledger.offer('c.ann', [shirt]) as Result);
  ok(worn.ok === false, '8: and neither can something on the body');
  s.do(s.ledger.using('c.ann', [], []) as Result);
  ok((s.do(s.ledger.offer('c.ann', [shirt, saber]) as Result)).ok === true, '8: taken off and put down, both go up');
  ok((s.do(s.ledger.offer('c.ann', ['i999']) as Result)).ok === false, '8: a row nobody has is refused too');
  ok((s.do(s.ledger.offer('c.ben', [shirt]) as Result)).ok === false, '8: and neither side can put up what the other owns');
}

// --- 9: the distances are the game's own -------------------------------------------------------------------
{
  const s = server();
  const held = pair(s);
  ok(GROUP_RANGES.trade === 8, '9: the client\'s own table gives a trade 8 m, and that is the number enforced');
  s.clear();
  const far = s.do(s.ledger.ask('c.ann', 'c.ben', GROUP_RANGES.trade + 1) as Result);
  ok(far.ok === false && s.to(1).some((m: any) => /too far/.test(m.why ?? '')), '9: asking from further off is refused with a word');
  ok((s.do(s.ledger.ask('c.ann', 'c.ben', Infinity) as Result)).ok === false, '9: and somebody on another world is out of range by definition');
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', [held.ann[0].id]) as Result);
  s.do(s.ledger.ready('c.ann', 2) as Result);
  const apart = s.do(s.ledger.ready('c.ben', 40) as Result);
  ok(apart.ok === false && s.rowsOnDisk() === 2, '9: two who have walked apart with the window open do not trade, and nothing moves');
  ok(s.ownersOnDisk().get('wear:shirt_s03') === 'c.ann', '9: the item is where it started');
  ok((s.do(s.ledger.ready('c.ben', 2) as Result)).ok === true, '9: and walking back and pressing again trades');
}

// --- 10: changing a pane takes both sides' word back ----------------------------------------------------------
{
  const s = server();
  const held = pair(s, ['shirt_s03', 'boots_s03']);
  const shirt = s.ledger.listFor('c.ann').find((r: any) => r.what === 'shirt_s03').id;
  const boots = s.ledger.listFor('c.ann').find((r: any) => r.what === 'boots_s03').id;
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', [shirt]) as Result);
  s.do(s.ledger.ready('c.ben', 2) as Result);
  s.clear();
  s.do(s.ledger.offer('c.ann', [shirt, boots]) as Result);
  ok(s.last(2)?.theirs.rows.length === 2 && s.last(2)?.yours.ready === 0, '10: changing what is in a pane takes back the other side\'s word, as the game\'s own window did');
  ok(s.last(1)?.yours.rows.length === 2 && s.last(1)?.theirs.ready === 0, '10: and each side is told the whole trade from its own end, so neither has to work the other out');
  s.do(s.ledger.ready('c.ann', 2) as Result);
  ok(s.rowsOnDisk() === 3 && s.ownersOnDisk().get('wear:shirt_s03') === 'c.ann', '10: one side alone being happy hands nothing over');
  s.do(s.ledger.unready('c.ann') as Result);
  s.do(s.ledger.ready('c.ben', 2) as Result);
  ok(s.ownersOnDisk().get('wear:shirt_s03') === 'c.ann', '10: and taking a word back means the other side pressing does not finish it either');
  ok((s.do(s.ledger.ready('c.ann', 2) as Result)).ok === true && s.ownersOnDisk().get('wear:boots_s03') === 'c.ben', '10: both sides happy at once is the only thing that moves a row');
  ok(s.rowsOnDisk() === 3 && s.ledger.listFor('c.ben').length === 3, '10: three things before and three after');
}

// --- 11: a second of one thing is a second thing -------------------------------------------------------------------
{
  // It used to be refused whole: a character held one row of a kind. Now two of one shirt are two things,
  // so a gift of a second shirt is simply a second shirt -- and nothing is made or lost by it.
  const s = server();
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  s.do(s.ledger.here('c.ben', { session: 2, name: 'Ben' }) as Result);
  s.do(s.ledger.settle('c.ann', [{ kind: 'wear', what: 'shirt_s03', got: 1, thing: 'wshirt_s03|1|aaaa', tint: { index_color_1: 12 } }]) as Result);
  s.do(s.ledger.settle('c.ben', [{ kind: 'wear', what: 'shirt_s03', got: 2, thing: 'wshirt_s03|2|bbbb' }]) as Result);
  const mine = s.ledger.listFor('c.ann')[0].id;
  s.clear();
  const done = swap(s, [mine], []) as Result;
  ok(done.ok === true && done.moved === 1 && s.rowsOnDisk() === 2, '11: giving somebody a second of something they already have hands it over: two things before, two after');
  ok(s.ledger.listFor('c.ann').length === 0 && s.ledger.countOf('c.ben', 'wear', 'shirt_s03') === 2, '11: and they hold two of it, as two rows');
  const got = s.ledger.listFor('c.ben').find((r: any) => r.id === mine);
  ok(got?.thing === 'wshirt_s03|1|aaaa' && got?.tint?.index_color_1 === 12, '11: the shirt keeps its own name and its colour as it changes hands: the colour is the thing\'s');
  ok(s.last(2)?.got[0].thing === 'wshirt_s03|1|aaaa', '11: and the one taking it is told which thing it is');
  // The same two shirts the other way round is a swap of two things, each ending with one.
  const both = swap(s, [], [s.ledger.listFor('c.ben')[0].id]) as Result;
  ok(both.ok === true && s.ledger.listFor('c.ann').length === 1 && s.ledger.listFor('c.ben').length === 1 && s.rowsOnDisk() === 2, '11: and handing one back leaves one each, and still two in all');
}

// --- 12: what has a life on it ---------------------------------------------------------------------------------
{
  const s = server();
  pair(s);
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.clear();
  s.wait(LEDGER_TUNING['ask.wait'] + 1000);
  ok(s.ledger.tradeOf('c.ann') === null, '12: an invitation nobody answers is taken back');
  ok(s.to(1).some((m: any) => m.do === 'off') && s.to(2).some((m: any) => m.do === 'off'), '12: and both are told, so neither is left with a window nothing can answer');
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.clear();
  s.wait(LEDGER_TUNING.wait + 1000);
  ok(s.ledger.tradeOf('c.ann') === null && s.rowsOnDisk() === 2, '12: a trade nobody touches for a long while is broken off with the items where they started');
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.decline('c.ben') as Result);
  ok(s.ledger.tradeOf('c.ann') === null && s.rowsOnDisk() === 2, '12: and saying no ends it at once');
}

// --- 13: the rows are the world's, and the ledger is only what it read -------------------------------------------
{
  const s = server();
  const held = pair(s, ['shirt_s03', 'boots_s03'], ['pistol_cdef']);
  swap(s, [held.ann[0].id], [held.ben[0].id]);
  const before = s.ledger.listFor('c.ann').map((r: any) => `${r.id}:${r.kind}:${r.what}`).join(',');
  const back = s.restart();
  ok(back.listFor('c.ann').map((r: any) => `${r.id}:${r.kind}:${r.what}`).join(',') === before, '13: a ledger built from the file alone says exactly what the live one says, row for row');
  ok(back.size === s.ledger.size && back.size === s.rowsOnDisk(), '13: and holds exactly as many rows as there are on the disk: nothing kept only in memory, nothing written twice');
  const fresh = back.add('c.ann', 'wear', 'robe_jedi_padawan', 99);
  ok(fresh.ok === true && !s.ledger.rowFor('c.ann', 'wear', 'robe_jedi_padawan'), '13: a restarted ledger mints ids of its own that cannot land on one already in the file');
  ok(Object.keys(s.world.items).includes(fresh.row.id), '13: and what it writes is in the world beside the rest');
  // A file that holds a row this reader will not keep -- a second of one thing for one character,
  // which is the very case `load` says it is defending against, or a row from a later server with a
  // kind this one does not know -- still counts towards the next id.
  const odd: any = { ...s.world, items: { ...s.world.items } };
  odd.items.i77 = { id: 'i77', owner: 'c.cal', kind: 'wear', what: 'shirt_s03', got: 1 };
  odd.items.i78 = { id: 'i78', owner: 'c.cal', kind: 'wear', what: 'shirt_s03', got: 2 };
  odd.items.i79 = { id: 'i79', owner: 'c.cal', kind: 'house', what: 'shirt_s03', got: 3 };
  const read = new Ledger({ now: () => s.now(), write: () => {} }).load(odd);
  // It used to keep the first and leave the second on the disk, out of memory: a server before things
  // had names left exactly such rows behind it, and they are a character's own things.
  ok(read.listFor('c.cal').length === 2, '13: a file with two of one item for one character keeps both: they are two things');
  const names = read.listFor('c.cal').map((r: any) => r.thing);
  ok(names[0] !== names[1] && names.every((n: string) => n.endsWith('.i77') || n.endsWith('.i78')), `13: each named on read by the world and its own row (${names.join(', ')})`);
  const next = read.add('c.cal', 'weapon', 'pistol_cdef', 5);
  ok(next.ok === true && next.row.id !== 'i78' && next.row.id !== 'i79', '13: and the next thing anybody gains is not written on top of a row that is still in the file, whether this reader kept it or not');
  ok(applyItems(s.world, { t: 'nothing' } as never) === false, '13: a record the ledger does not know is not an error and changes nothing');
  ok(applyChange(s.world, { t: 'itemGone', id: fresh.row.id } as never) === true && s.world.items[fresh.row.id] === undefined, '13: and the store hands an item record here to be applied, which is what makes the log replay the same way twice');
}

// --- 14: a browser that has never said who it is has nothing here -------------------------------------------------
{
  const s = server();
  ok(s.ledger.holds('c.nobody') === false && s.ledger.listFor('c.nobody').length === 0, '14: a character the server has not been handed owns nothing as far as this is concerned');
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  s.do(s.ledger.here('c.ben', { session: 2, name: 'Ben' }) as Result);
  const asked = s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  ok(asked.ok === false && /does not hold/.test(asked.why ?? ''), '14: and cannot trade, because there is nothing the server could promise on its behalf');
  ok(s.rowsOnDisk() === 0 && s.log.length === 0, '14: a session that never hands anything up writes nothing at all, which is the game exactly as it was');
  ok(s.ledger.describe() === 'nothing owned', '14: and merely being asked what somebody owns leaves nothing behind: no table for them, and nobody counted on the status page as owning things');
  s.do(s.ledger.settle('c.ann', [{ kind: 'wear', what: 'shirt_s03', got: 1 }]) as Result);
  ok(/1 things owned by 1 characters/.test(s.ledger.describe()), '14: one character with one thing is one character with one thing');
  s.ledger.drop('c.ann', s.ledger.listFor('c.ann')[0].id);
  ok(s.ledger.describe() === 'nothing owned', '14: and giving the last of them up leaves no empty table behind either');
}

// ===== A row per thing ==============================================================================
//
// Two of one shirt are two rows now, each under the name its browser minted (`thing`) with its own
// colours (`tint`). What may never change is the count: every check below counts the rows, writes
// through the store's own `applyChange` and reads the world back as a restart would.

const shirt = (thing: string, got = 1, extra: Record<string, unknown> = {}) => ({ kind: 'wear', what: 'shirt_s03', got, thing, ...extra });

// --- 15: what a browser may send about things --------------------------------------------------------
{
  ok(ITEMS_VERSION === 2, '15: a server that keeps a row per thing says items 2 in its hail');
  ok(cleanThing('wshirt_s03|lq2x|0a1b') === 'wshirt_s03|lq2x|0a1b' && cleanThing('lq2x.i12') === 'lq2x.i12', '15: a thing\'s name is the browser\'s own, with its bar, or the server\'s');
  ok(cleanThing('a b') === '' && cleanThing('__proto__') === '' && cleanThing('x'.repeat(81)) === '' && cleanThing(7) === '', '15: and nothing else is one');
  const listed = cleanItems({ t: 'items', do: 'list', rows: [shirt('a|1'), shirt('b|2', 2, { tint: { index_color_1: 5, __proto__x: 1 } }), shirt('bad name')] });
  ok(listed?.rows.length === 3 && listed.rows[0].thing === 'a|1' && listed.rows[1].tint?.index_color_1 === 5 && listed.rows[2].thing === undefined, '15: a hand-up keeps each row\'s name and colours, and a name that is not one is left off rather than the row');
  const t = cleanTintSet({ index_color_1: -(0xff0000 + 1), index_color_2: 300, '/shared_owner/index_color_skin': 2.4, 'bad key!': 3, constructor: 1 });
  ok(t?.index_color_1 === -(0xff0000 + 1) && t?.index_color_2 === 255 && t?.['/shared_owner/index_color_skin'] === 2 && !('bad key!' in (t ?? {})) && Object.keys(t ?? {}).length === 3, '15: a colour is a palette index or a colour of its own below nought, by the customizer\'s own names');
  ok(cleanTintSet({ a: -99999999 })?.a === -16777216, '15: and white is as low as one goes');
  ok(cleanTintSet(null) === null && cleanTintSet({}) === null, '15: none is null, which is a real answer');
  ok(cleanTintSet({ 'bad key!': 1 }) === undefined && cleanTintSet('red') === undefined && cleanTintSet([1]) === undefined, '15: and a set of nothing but nonsense is no answer at all, so it cannot clear a colour');
  const many: Record<string, number> = {};
  for (let i = 0; i < 40; i++) many[`index_color_${i}`] = i;
  ok(Object.keys(cleanTintSet(many) ?? {}).length === LEDGER_TUNING.tintKeys, `15: a thing carries at most ${LEDGER_TUNING.tintKeys} colours`);
  const tinted = cleanItems({ t: 'items', do: 'tint', id: 'i4', tint: { index_color_1: 7 }, at: 9e15 }, LEDGER_TUNING, 1000);
  ok(tinted?.do === 'tint' && tinted.id === 'i4' && tinted.tint.index_color_1 === 7 && tinted.at === 1000, '15: a colour names its row, and a time past this server\'s clock is brought back to it: nothing was coloured after the server heard of it');
  ok(cleanItems({ t: 'items', do: 'tint', id: 'i4', tint: null, at: 400 }, LEDGER_TUNING, 1000)?.at === 400, '15: while a time before it is kept as the browser said');
  const short = cleanItems({ t: 'items', do: 'list', rows: [['wear', 'shirt_s03', 7, 'a|1'], ['weapon', 'pistol_cdef', 8], ['nonsense', 'x', 1, 'b|1'], ['wear', '__proto__', 1, 'c|1'], ['wear', 'hat_s04', 2, 'bad name']] });
  ok(short?.rows.length === 3 && short.rows[0].kind === 'wear' && short.rows[0].what === 'shirt_s03' && short.rows[0].got === 7 && short.rows[0].thing === 'a|1' && short.rows[1].kind === 'weapon' && short.rows[1].thing === undefined && short.rows[2].what === 'hat_s04' && short.rows[2].thing === undefined, '15: a hand-up\'s row may be the short array a browser built for named things sends, `[kind, what, got, thing]`, read and refused by the very same rules as an object');
  ok(cleanItems({ t: 'items', do: 'tint', id: 'i4', tint: null }, LEDGER_TUNING, 1000)?.tint === null, '15: taking a colour off is a colour word too');
  ok(cleanItems({ t: 'items', do: 'tint', id: 'i4' }) === undefined && cleanItems({ t: 'items', do: 'tint', tint: null }) === undefined, '15: and one that says neither which nor what is dropped');
  ok(cleanItems({ t: 'items', do: 'add', kind: 'wear', what: 'shirt_s03', thing: 'x|1' })?.thing === 'x|1', '15: an add may name the thing it is');
}

// --- 16: two of one shirt handed up, and the log played back --------------------------------------------
{
  const s = server();
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  const up = s.do(s.ledger.settle('c.ann', [shirt('wshirt_s03|1|aaaa', 1, { tint: { index_color_1: 3 }, tintAt: 50 }), shirt('wshirt_s03|2|bbbb', 2), shirt('wshirt_s03|2|bbbb', 2)]) as Result);
  ok(up.rows?.length === 2 && s.rowsOnDisk() === 2, '16: two of one shirt handed up are two rows, and the same name twice is one');
  ok(up.rows!.map((r: any) => r.thing).join() === 'wshirt_s03|1|aaaa,wshirt_s03|2|bbbb', '16: each under the name its browser gave it');
  const set = s.log.find((r) => r.t === 'itemSet');
  ok(set?.rows.length === 2 && set.rows[0].thing === 'wshirt_s03|1|aaaa' && set.rows[0].tint.index_color_1 === 3 && set.rows[0].tintAt === 50, '16: the one record that writes a whole list carries every name and colour');
  const back = s.restart();
  ok(back.listFor('c.ann').map((r: any) => `${r.thing}:${r.tint?.index_color_1 ?? '-'}`).join() === 'wshirt_s03|1|aaaa:3,wshirt_s03|2|bbbb:-', '16: and a server started again reads both back, names and colours and all');
  ok(back.countOf('c.ann', 'wear', 'shirt_s03') === 2 && back.rowFor('c.ann', 'wear', 'shirt_s03')?.thing === 'wshirt_s03|1|aaaa', '16: two of it are counted, and the row asked for by what it is is the oldest');
  s.do(s.ledger.here('c.bob', { session: 3, name: 'Bob' }) as Result);
  const short = s.do(s.ledger.settle('c.bob', [['wear', 'shirt_s03', 1, 'x|1'], ['wear', 'shirt_s03', 2, 'x|2'], ['wear', 'shirt_s03', 2, 'x|2']]) as Result);
  ok(short.rows?.length === 2 && short.rows.map((r: any) => r.thing).join() === 'x|1,x|2' && s.restart().countOf('c.bob', 'wear', 'shirt_s03') === 2, '16: a list of short rows is written down the same way: two of one shirt are two, the same name twice is one');
}

// --- 17: a list from a browser built before things had names --------------------------------------------
{
  const s = server();
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  const up = s.do(s.ledger.settle('c.ann', [{ kind: 'wear', what: 'shirt_s03', got: 1 }, { kind: 'wear', what: 'shirt_s03', got: 2 }, { kind: 'wear', what: 'hat_s04', got: 3 }]) as Result);
  ok(up.rows?.length === 2 && s.rowsOnDisk() === 2, '17: a list that names nothing is folded by kind and id, as it always was, so an old browser cannot make two of anything');
  const epoch36 = s.world.epoch.toString(36);
  ok(up.rows!.every((r: any) => r.thing === `${epoch36}.${r.id}`), '17: and each row is given the server\'s own name, the world\'s birth and the row');
  ok(s.log.find((r) => r.t === 'itemSet').rows.every((r: any) => r.thing === undefined), '17: which is worked out on read and never written down');
}

// --- 18: an add said twice ---------------------------------------------------------------------------------
{
  const s = server();
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  s.do(s.ledger.settle('c.ann', [shirt('a|1')]) as Result);
  const one = s.ledger.add('c.ann', 'wear', 'shirt_s03', 5, { thing: 'a|2' });
  const again = s.ledger.add('c.ann', 'wear', 'shirt_s03', 5, { thing: 'a|2' });
  ok(one.ok === true && !one.already && one.row.thing === 'a|2', '18: a named add of a second shirt is a second shirt');
  ok(again.ok === true && again.already === true && again.same === true && again.row.id === one.row.id && s.rowsOnDisk() === 2, '18: and the same word again is the same thing, never a third: a retried word cannot make two');
  ok(s.ledger.add('c.ann', 'wear', 'shirt_s03').already === true && s.rowsOnDisk() === 2, '18: an unnamed add still only makes sure there is one, which is what a job\'s reward and an old browser ask');
  ok(s.ledger.add('c.ann', 'wear', 'hat_s04').already !== true && s.rowsOnDisk() === 3, '18: and makes one where there is none');
  const clash = s.ledger.add('c.ann', 'weapon', 'pistol_cdef', 6, { thing: 'a|2' });
  ok(clash.ok === true && clash.row.thing !== 'a|2' && clash.row.thing === `${s.world.epoch.toString(36)}.${clash.row.id}` && s.ledger.listFor('c.ann').length === 4, '18: a name another of this character\'s things already has is not taken over: the new one gets the server\'s own');
  const added = s.log.filter((r) => r.t === 'item');
  ok(added.find((r) => r.id === one.row.id)?.item.thing === 'a|2' && added.find((r) => r.id === clash.row.id)?.item.thing === undefined, '18: a browser\'s name is written down and the server\'s own is not, since it is worked out on read');
  const back = s.restart();
  ok(back.listFor('c.ann').map((r: any) => r.thing).join() === s.ledger.listFor('c.ann').map((r: any) => r.thing).join(), '18: and a restart names every one the same');
}

// --- 19: names worked out on read, and the clash guard --------------------------------------------------------
{
  const world: any = emptyWorld(424242);
  world.items.i1 = { id: 'i1', owner: 'c.x', kind: 'wear', what: 'shirt_s03', got: 1 };
  world.items.i2 = { id: 'i2', owner: 'c.x', kind: 'wear', what: 'shirt_s03', got: 2, thing: 'dup|1' };
  world.items.i3 = { id: 'i3', owner: 'c.x', kind: 'wear', what: 'hat_s04', got: 3, thing: 'dup|1' };
  world.items.i4 = { id: 'i4', owner: 'c.y', kind: 'wear', what: 'hat_s04', got: 4, thing: 'dup|1' };
  const writes: any[] = [];
  const read = new Ledger({ write: (r: any) => writes.push(r) }).load(world);
  const e = (424242).toString(36);
  const names = read.listFor('c.x').map((r: any) => r.thing);
  ok(names.join() === `${e}.i1,dup|1,${e}.i3`, `19: a row with no name is named by the world and the row, and a name taken twice in one character's table goes to the server's own the second time (${names.join(', ')})`);
  ok(read.listFor('c.y')[0].thing === 'dup|1', '19: while the same name for a different character is no clash at all');
  ok(read.size === 4 && writes.length === 0, '19: every row is kept, and reading writes nothing: the disk is not touched');
}

// --- 20: a second copy changes hands, and its name is taken where it lands -------------------------------------
{
  const s = server();
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  s.do(s.ledger.here('c.ben', { session: 2, name: 'Ben' }) as Result);
  // A hand-edited file, or a browser lying about its names, is the only way two characters hold one name.
  s.do(s.ledger.settle('c.ann', [shirt('same|1', 1, { tint: { index_color_1: 9 }, tintAt: 70 }), shirt('a|2', 2)]) as Result);
  s.do(s.ledger.settle('c.ben', [shirt('same|1', 3)]) as Result);
  const give = s.ledger.listFor('c.ann').find((r: any) => r.thing === 'same|1').id;
  const before = s.rowsOnDisk();
  s.clear();
  const done = swap(s, [give], []) as Result;
  ok(done.ok === true && s.rowsOnDisk() === before, '20: a second copy changes hands and the world holds as many things as before');
  const landed = s.ledger.listFor('c.ben').find((r: any) => r.id === give);
  const own = `${s.world.epoch.toString(36)}.${give}`;
  ok(landed?.thing === own && landed.tint?.index_color_1 === 9, '20: a name the taker already has is changed to the server\'s own for that row, and the colour goes with it');
  const move = s.log.filter((r) => r.t === 'itemMove').pop();
  ok(move?.moves[0].thing === own, '20: and the new name is in the move, so the log says exactly what the live server did');
  const back = s.restart();
  ok(back.listFor('c.ben').map((r: any) => r.thing).sort().join() === s.ledger.listFor('c.ben').map((r: any) => r.thing).sort().join() && back.size === before, '20: a restart names it the same, and counts the same');
  ok(back.listFor('c.ann').length === 1 && back.listFor('c.ben').length === 2, '20: one left with the giver, two with the taker');
}

// --- 21: colours -------------------------------------------------------------------------------------------------
{
  const s = server();
  pair(s);
  const ann = s.ledger.listFor('c.ann')[0];
  const lines = s.log.length;
  ok(s.ledger.tint('c.ben', ann.id, { index_color_1: 4 }).ok === false && s.log.length === lines, '21: nobody but its owner colours a thing');
  const set = s.ledger.tint('c.ann', ann.id, { index_color_1: 4 }, s.now());
  ok(set.ok === true && set.row.tint.index_color_1 === 4 && s.log.length === lines + 1 && s.lazy[s.lazy.length - 1] === true, '21: its owner does, and the colour is written lazily: in the log in its place, flushed with the next change');
  ok(s.ledger.tint('c.ann', ann.id, { index_color_1: 4 }, s.now()).same === true && s.log.length === lines + 1, '21: the same colour again writes nothing');
  ok(s.ledger.tint('c.ann', ann.id, { index_color_1: 6 }, s.now() - 5000).ok === false, '21: and one set earlier than the one already on it is refused: the newest wins');
  s.do(s.ledger.ask('c.ann', 'c.ben', 2) as Result);
  s.do(s.ledger.accept('c.ben') as Result);
  s.do(s.ledger.offer('c.ann', [ann.id]) as Result);
  s.wait(1);
  ok(s.ledger.tint('c.ann', ann.id, { index_color_1: 1 }, s.now()).ok === false, '21: nor may a thing be coloured while it is up in a trade: the other side gets what they were shown');
  ok((s.last(2) as any)?.theirs.rows[0].tint.index_color_1 === 4, '21: which is the colour on it, in the pane they are looking at');
  s.do(s.ledger.cancel('c.ann') as Result);
  s.wait(10);
  const off = s.ledger.tint('c.ann', ann.id, null, s.now());
  ok(off.ok === true && off.row.tint === null, '21: taking a colour off is a colour too');
  const rec = s.log[s.log.length - 1];
  ok(rec.t === 'item' && rec.item.tint === null && 'tint' in rec.item, '21: and it is written as null, never left out');
  const back = s.restart();
  ok(back.listFor('c.ann')[0].tint === null && back.listFor('c.ann')[0].tintAt === s.now(), '21: so a log played back does not bring the old colour home');
  ok(back.size === 2, '21: and colouring things never changes how many there are');
}

// --- 21b: a colour stamped by a clock that runs fast ---------------------------------------------------------------
//
// The newest colour wins, and each browser stamps its own: one whose clock ran three hours fast, taken at
// its word, would have refused every colour put on that thing for three hours after, anywhere. Nothing can
// have been coloured after the server heard of it, so every time it compares is held to its own clock.
{
  const s = server();
  pair(s);
  const ann = s.ledger.listFor('c.ann')[0];
  const fast = s.ledger.tint('c.ann', ann.id, { index_color_1: 4 }, s.now() + 3 * 3600 * 1000);
  ok(fast.ok === true && fast.row.tintAt === s.now(), '21b: a colour stamped three hours past the server\'s clock is taken as set the moment it was heard');
  s.wait(1000);
  const next = s.ledger.tint('c.ann', ann.id, { index_color_1: 6 }, s.now());
  ok(next.ok === true && next.row.tint.index_color_1 === 6 && next.row.tintAt === s.now(), '21b: so a colour set a second later by a clock that keeps time is not refused as the older of the two');
  ok(s.ledger.tint('c.ann', ann.id, { index_color_1: 8 }, s.now() - 500).ok === false, '21b: while one truly set before it still is: the newest still wins');
  const added = s.ledger.add('c.ann', 'wear', 'hat_s04', 5, { thing: 'h|1', tint: { index_color_1: 1 }, tintAt: s.now() + 9e6 });
  ok(added.ok === true && added.row.tintAt === s.now(), '21b: a thing added with a colour from a fast clock is held to the same rule');
  s.do(s.ledger.here('c.cal', { session: 3, name: 'Cal' }) as Result);
  const up = s.do(s.ledger.settle('c.cal', [shirt('c|1', 1, { tint: { index_color_1: 2 }, tintAt: s.now() + 9e6 })]) as Result);
  ok(up.rows?.[0].tintAt === s.now(), '21b: and so is a backpack handed up');
  const back = s.restart();
  ok(back.listFor('c.ann').find((r: any) => r.id === ann.id)?.tintAt === s.now() && back.listFor('c.cal')[0].tintAt === s.now(), '21b: what is written down is the time the server took, so a restart compares the same');
}

// --- 22: what the store keeps of a thing -----------------------------------------------------------------------
{
  const world: any = emptyWorld(5);
  ok(applyItems(world, { t: 'itemSet', owner: 'c.z', rows: [{ id: 'i1', kind: 'wear', what: 'a', got: 1, thing: 'n|1', tint: { index_color_1: 2 }, tintAt: 9 }, { id: 'i2', kind: 'wear', what: 'a', got: 2 }] }) === true, '22: a whole list is applied');
  ok(world.items.i1.thing === 'n|1' && world.items.i1.tint.index_color_1 === 2 && world.items.i1.tintAt === 9 && world.items.i2.thing === undefined, '22: with its names and colours kept where they are, and none made up where there are none');
  applyItems(world, { t: 'item', id: 'i1', item: { tint: null, tintAt: 12 } });
  ok(world.items.i1.tint === null && world.items.i1.thing === 'n|1' && world.items.i1.owner === 'c.z', '22: a colour taken off is null on the row and nothing else about it moves');
  applyItems(world, { t: 'itemMove', moves: [{ id: 'i2', owner: 'c.q', got: 4, thing: 'moved|1' }] });
  ok(world.items.i2.owner === 'c.q' && world.items.i2.thing === 'moved|1', '22: and a move carries the name a thing was given where it landed');
}

// --- 23: a browser built before things had names is never handed a second of something it has -------------------
//
// It folds its list by kind and id and keeps one, so a second shirt the server held for it would be a shirt it
// never sees: the old refusal stands for it, while a browser that names its things takes the second.
{
  const s = server();
  s.do(s.ledger.here('c.ann', { session: 1, name: 'Ann' }) as Result);
  s.do(s.ledger.here('c.old', { session: 2, name: 'Old', named: false }) as Result);
  s.do(s.ledger.here('c.ben', { session: 3, name: 'Ben' }) as Result);
  s.do(s.ledger.settle('c.ann', [shirt('a|1', 1), shirt('a|2', 2), { kind: 'wear', what: 'hat_s04', got: 3, thing: 'h|1' }]) as Result);
  s.do(s.ledger.settle('c.old', [{ kind: 'wear', what: 'shirt_s03', got: 4 }]) as Result);
  s.do(s.ledger.settle('c.ben', [shirt('b|1', 5)]) as Result);
  const annShirt = s.ledger.listFor('c.ann').find((r: any) => r.thing === 'a|1').id;
  const annHat = s.ledger.listFor('c.ann').find((r: any) => r.thing === 'h|1').id;
  s.clear();
  s.do(s.ledger.ask('c.ann', 'c.old', 2) as Result);
  s.do(s.ledger.accept('c.old') as Result);
  s.do(s.ledger.offer('c.ann', [annShirt]) as Result);
  s.do(s.ledger.ready('c.ann', 2) as Result);
  const refused = s.do(s.ledger.ready('c.old', 2) as Result);
  ok(refused.ok === false && /already has one of those/.test(refused.why ?? '') && s.ledger.countOf('c.old', 'wear', 'shirt_s03') === 1 && s.ledger.countOf('c.ann', 'wear', 'shirt_s03') === 2, `23: a second shirt for a browser that keeps one of each is refused whole, and nothing moves (${refused.why})`);
  // Something it does not have goes, and a second line naming its things on the same character takes the shirt.
  s.do(s.ledger.ask('c.ann', 'c.old', 2) as Result);
  s.do(s.ledger.accept('c.old') as Result);
  s.do(s.ledger.offer('c.ann', [annHat]) as Result);
  s.do(s.ledger.ready('c.ann', 2) as Result);
  ok((s.do(s.ledger.ready('c.old', 2) as Result)).ok === true && s.ledger.countOf('c.old', 'wear', 'hat_s04') === 1, '23: while something it has none of is handed over as ever');
  s.ledger.naming(2, true);
  ok(s.ledger.namesThings('c.old') === true, '23: a hello from a browser that names its things says so for that line');
  s.do(s.ledger.ask('c.ann', 'c.old', 2) as Result);
  s.do(s.ledger.accept('c.old') as Result);
  s.do(s.ledger.offer('c.ann', [annShirt]) as Result);
  s.do(s.ledger.ready('c.ann', 2) as Result);
  ok((s.do(s.ledger.ready('c.old', 2) as Result)).ok === true && s.ledger.countOf('c.old', 'wear', 'shirt_s03') === 2, '23: and then a second shirt is simply a second shirt');
  s.ledger.naming(9, false);
  ok(s.ledger.namesThings('c.old') === true, '23: a line the character is not played on says nothing about it');
}

// --- 24: a row id is never handed out twice, not even once its row has gone and the server has started again ------
//
// A row the server names itself is `<world epoch>.<row id>`, so an id handed out twice is a name handed out
// twice. The counter lives in the world file, carried by the records that write a row, so it is in the log the
// moment the row is and in the snapshot after; the ids in the file alone forget the newest row once it is dropped.
{
  const dir = mkdtempSync(join(tmpdir(), 'swg-ledger-seq-'));
  try {
    const open = () => openStore({ dir, epoch: 1_700_000_000_000, saveEvery: 0 });
    const ledgerOver = (store: any) => new Ledger({ write: (rec: any, lazy?: boolean) => store.change(rec, { lazy: !!lazy }), epoch: store.data.epoch }).load(store.data);
    const first = open();
    const a = ledgerOver(first);
    a.here('c.ann', { session: 1, name: 'Ann' });
    a.settle('c.ann', [shirt('a|1', 1)]);
    const reward = a.add('c.ann', 'weapon', 'pistol_cdef', 2);
    ok(reward.ok === true && reward.row.thing === `${(1_700_000_000_000).toString(36)}.${reward.row.id}`, `24: a thing the server writes down unnamed is named by the world and its row (${reward.row.thing})`);
    ok(a.drop('c.ann', reward.row.id).ok === true, '24: and then it is dropped: the newest row is gone from the file');
    // A power cut: the log has everything and no snapshot was written.
    closeSync(first.fd);
    first.fd = -1;
    const second = open();
    const b = ledgerOver(second);
    b.here('c.ann', { session: 1, name: 'Ann' });
    const next = b.add('c.ann', 'weapon', 'pistol_cdef', 3);
    ok(next.ok === true && next.row.id !== reward.row.id && next.row.thing !== reward.row.thing, `24: a server started again from the log mints a fresh id and a fresh name (${reward.row.id} was ${next.row.id === reward.row.id ? 'handed out again' : `followed by ${next.row.id}`})`);
    ok(b.drop('c.ann', next.row.id).ok === true, '24: and that one is dropped too');
    // A clean stop this time: the snapshot is written and the log emptied, so the counter must be in the file.
    second.close();
    ok(!/"t":"item/.test(readFileSync(join(dir, 'world.log'), 'utf8')), '24: the snapshot has been written and the log holds no item line');
    const third = open();
    const c = ledgerOver(third);
    c.here('c.ann', { session: 1, name: 'Ann' });
    const after = c.add('c.ann', 'weapon', 'pistol_cdef', 4);
    ok(after.ok === true && ![reward.row.id, next.row.id].includes(after.row.id), `24: and a server started again from the snapshot alone mints past both (${after.row.id})`);
    third.close();
    // A world written before there was a counter says where to start by its rows, as it always did.
    const old: any = emptyWorld(7);
    old.items.i5 = { id: 'i5', owner: 'c.x', kind: 'wear', what: 'shirt_s03', got: 1 };
    const fromOld = new Ledger({ write: () => {} }).load(old);
    ok(fromOld.add('c.x', 'wear', 'hat_s04', 2).row.id === 'i6', '24: a world with no counter starts past the rows it holds, so nothing on the disk changes its meaning');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${checks} checks passed`);
