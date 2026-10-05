// The browser's half of the ledger and of a trade (src/net/trade.ts), and the cache underneath it
// (src/player/equipment.ts's reconcile, src/core/characters.ts's mark), driven with no page and no
// socket.
//
// What is pinned here is the one thing this wave must never do: duplicate an item, or lose one. So
// the rows are counted before and after every way a trade can end, and the ways it can end are all
// here -- a line that drops, a browser taken over, a refusal, both sides pulling the plug in the
// middle. The rule that makes all of them safe is that **nothing in the browser ever moves an item**:
// only the server's own list does, and a test that could move one without a list would fail.
//
// The other half is what a session with no server must be: silent. Not one word may go out, nothing
// may open, and the backpack must be exactly the local storage it has always been, because a browser
// with no address set has to be the game that was there before any of this was written.
//
// The wire here is the server's own (server/ledger.mjs, and the list at the top of server/relay.mjs):
// rows carry the id the server minted for them, an offer names those ids, and what is worn and held
// is said in them too. Both modules are node-loadable as they are.
import assert from 'node:assert/strict';
import { knownToServer, markKnownToServer, type SavedCharacter } from '../../../src/core/characters.ts';
import { Equipment, reconcileWords, type EquipmentDeps } from '../../../src/player/equipment.ts';
import { GROUP_RANGE } from '../../../src/net/groups.ts';
import { TRADE_TUNE, Trade, tradeNow, tradeWords, tuneTrade, type TradeItem } from '../../../src/net/trade.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- a ledger with a server on the other end, and everything it was told kept for the test --------

/**
 * A thing by a short key: `wear:hat_s04` is the first hat, `wear:hat_s04#2` a second of it. The name is
 * the key's own (`wear|hat_s04|1`), which is a name a server keeps as it is given.
 */
function thingOf(key: string): string {
  const [what, n] = key.split('#');
  return `${what.replace(':', '|')}|${n ?? '1'}`;
}

/** The item a key names, as this browser holds it: kind, catalogue id and its own name. */
function item(key: string): TradeItem {
  const what = key.split('#')[0];
  const i = what.indexOf(':');
  return { kind: what.slice(0, i) as 'wear' | 'weapon', id: what.slice(i + 1), got: 5, thing: thingOf(key) };
}

/** `wear:hat_s04` as a server that keeps a row per thing sends a row of it: its own id, the kind, the catalogue id, the thing. */
function row(key: string, id: string, named = true) {
  const it = item(key);
  return named ? { id, kind: it.kind, what: it.id, got: 5, thing: it.thing } : { id, kind: it.kind, what: it.id, got: 5 };
}

function make(authority: 'me' | 'server' = 'server', me = 7, items = 2) {
  const sent: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const lists: { items: TradeItem[]; take: string }[] = [];
  const windows: (null | { mine: number; theirs: number; you: boolean; them: boolean })[] = [];
  const places = new Map<number, [number, number, number]>();
  /** What this browser owns and what each thing is doing, by the thing's name. */
  const owned = new Set<string>();
  const using = new Map<string, 'worn' | 'right' | 'left'>();
  /** The row id the make-believe server has minted for each thing. */
  const ids = new Map<string, string>();
  let next = 1;
  let clock = 1_000_000;
  const t = new Trade(() => clock / 1000);
  t.authority = () => authority;
  t.itemsVersion = () => items;
  t.selfId = () => me;
  t.serverNow = () => clock;
  t.send = (msg) => void sent.push(msg);
  t.onNote = (text) => void notes.push(text);
  t.onList = (items, take) => void lists.push({ items, take });
  t.onWindow = (w) => void windows.push(w ? { mine: w.mine.length, theirs: w.theirs.length, you: w.youReady, them: w.themReady } : null);
  t.owns = (thing) => owned.has(thing);
  t.inUse = (thing) => using.get(thing) ?? null;
  t.meAt = (out) => {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return true;
  };
  t.peerAt = (id, out) => {
    const p = places.get(id);
    if (!p) return false;
    out.x = p[0];
    out.y = p[1];
    out.z = p[2];
    return true;
  };
  // The make-believe server mints a row per thing, as the real one does: two of one shirt are two ids.
  const idOf = (key: string) => {
    const thing = thingOf(key);
    let id = ids.get(thing);
    if (!id) {
      id = `i${next++}`;
      ids.set(thing, id);
    }
    return id;
  };
  const named = items >= 2;
  return {
    t,
    sent,
    notes,
    lists,
    windows,
    places,
    owned,
    using,
    ids,
    idOf,
    at(ms: number) {
      clock = ms;
    },
    /** The server's own `items list`, which is the only thing that ever writes a backpack. */
    list(keys: string[], take: 'browser' | 'server' = 'server') {
      t.handle({ t: 'items', do: 'list', take, rows: keys.map((key) => row(key, idOf(key), named)) });
    },
    /** The server's own `trade state`, from this side's end. */
    state(withId: number, name: string, mine: string[], theirs: string[], you = false, them = false) {
      t.handle({
        t: 'trade',
        do: 'state',
        id: 't1',
        with: withId,
        name,
        yours: { rows: mine.map((key) => row(key, idOf(key), named)), ready: you ? 1 : 0 },
        theirs: { rows: theirs.map((key) => row(key, idOf(key), named)), ready: them ? 1 : 0 },
      });
    },
  };
}

type Fake = ReturnType<typeof make>;

const did = (f: Fake, what: string) => f.sent.filter((m) => m.do === what);

// ---- with no server, nothing at all ----------------------------------------------------------------

{
  const f = make('me');
  f.owned.add(thingOf('weapon:baton_stun'));
  f.t.mine = () => [item('weapon:baton_stun')];
  f.t.using = () => ({ worn: [], held: [] });
  ok(f.t.active === false, 'with no server the ledger is not active');
  ok(f.t.askTrade(9, 'han') !== '' && f.sent.length === 0, 'asking to trade sends nothing and says why');
  f.t.accept();
  f.t.decline();
  f.t.cancel();
  f.t.sync();
  f.t.tell();
  f.t.tellUsing();
  f.t.noteAdded(item('weapon:baton_stun'));
  f.t.noteDropped(item('weapon:baton_stun'));
  f.t.noteTint(thingOf('weapon:baton_stun'), { index_color_1: 3 }, 1);
  f.t.step(0.25);
  ok(f.sent.length === 0, 'not one word about items or trading goes out: the game played alone is the game it was');
  ok(f.t.putIn(item('weapon:baton_stun')) === 'there is no trade open', 'nothing can be put into a trade that does not exist');
  ok(f.t.window === null && f.t.asked === null && f.t.known === false && f.t.list.length === 0, 'there is no window, no question and no list');
  ok(f.lists.length === 0, 'and nothing has been told to write the backpack from');
}

// ---- the game's own distance ------------------------------------------------------------------------

{
  const f = make();
  f.places.set(9, [0, 0, 6]);
  f.places.set(11, [0, 0, 40]);
  ok(f.t.askTrade(7) !== '' && f.sent.length === 0, 'you cannot trade with yourself');
  ok(f.t.askTrade(0) !== '' && f.sent.length === 0, 'nor with nobody');
  ok(f.t.askTrade(12, 'nobody') === 'nobody is not on this world', 'somebody who is not here is not here, rather than being 16384 m away');
  const far = f.t.askTrade(11, 'leia');
  ok(far.includes('40 m') && far.includes(`${GROUP_RANGE.trade} m`) && f.sent.length === 0, `past the game's own ${GROUP_RANGE.trade} m it is refused, with how far off they are (${far})`);
  ok(f.t.askTrade(9, 'han') === '' && did(f, 'ask').length === 1 && f.sent[0].to === 9, 'within it the asking goes out');
  ok(f.t.window === null, 'and nothing opens here: the server opens the window on both sides or on neither');
}

// ---- a question, and its countdown -------------------------------------------------------------------

{
  const f = make();
  f.t.handle({ t: 'trade', do: 'asked', id: 't1', from: 9, name: 'Han', until: 1_030_000 });
  ok(f.t.asked?.name === 'Han' && Math.ceil(f.t.asked.left) === 30, 'a question carries who asked and how long is left');
  f.at(1_020_000);
  ok(f.t.step(0.25) === true && Math.ceil(f.t.asked!.left) === 10, 'the countdown is read off the server’s clock, not this machine’s');
  f.at(1_031_000);
  f.t.step(0.25);
  ok(f.t.asked === null && f.notes.some((n) => n.includes('not answered')), 'one that lapses goes, and says so');
  f.t.handle({ t: 'trade', do: 'asked', id: 't1', from: 9, name: 'Han' });
  f.t.accept();
  ok(did(f, 'accept').length === 1 && f.t.asked === null, 'taking it up sends the word and takes the question down');
}

// ---- what may be put in, and what may not --------------------------------------------------------------

{
  const f = make();
  for (const key of ['weapon:baton_stun', 'wear:shirt_s03', 'wear:hat_s04']) f.owned.add(thingOf(key));
  f.t.using = () => ({ worn: [item('wear:shirt_s03')], held: [item('weapon:baton_stun')] });
  f.using.set(thingOf('wear:shirt_s03'), 'worn');
  f.using.set(thingOf('weapon:baton_stun'), 'right');
  f.list(['weapon:baton_stun', 'wear:shirt_s03', 'wear:hat_s04']);
  const told = did(f, 'using').pop()!;
  ok(!!told && (told.worn as string[]).length === 1 && (told.held as string[]).length === 1, 'a list arriving is when the server is told what is worn and held, by its own row ids');
  f.state(9, 'Han', [], []);
  ok(f.t.window?.name === 'Han', 'the window is what the server said it is');
  const worn = f.t.putIn(item('wear:shirt_s03'));
  ok(worn.includes('wearing') && did(f, 'offer').length === 0, `something being worn is refused in words, not dropped in silence (${worn})`);
  const held = f.t.putIn(item('weapon:baton_stun'));
  ok(held.includes('right hand') && did(f, 'offer').length === 0, `and so is something in a hand (${held})`);
  ok(f.t.putIn(item('wear:robe_jedi_padawan')) === 'you do not own that', 'what is not owned cannot be offered');
  f.owned.add(thingOf('wear:cloak_s01'));
  ok(f.t.putIn(item('wear:cloak_s01')) === 'the server has not written that one down yet', 'and neither can something the server has no row for: an offer names the server’s own row');
  ok(f.t.putIn(item('wear:hat_s04')) === '' && did(f, 'offer').length === 1, 'what is owned, free and written down goes over');
  const offer = did(f, 'offer')[0];
  ok(Array.isArray(offer.rows) && (offer.rows as string[])[0] === f.idOf('wear:hat_s04'), 'by the row id the server minted, and never by anything this browser made up');
  ok(f.t.window!.mine.length === 0, 'and still nothing is in the window: only the server puts it there');
  const drawn = f.windows.length;
  f.state(9, 'Han', ['wear:hat_s04'], []);
  ok(f.t.window!.mine.length === 1 && f.t.offered(item('wear:hat_s04')), 'the server says what is in, and then it is in');
  ok(f.windows.length === drawn + 1 && f.windows.pop()!.mine === 1, 'and the panel is told every time it moves, not only when a window opens and closes');
  ok(f.t.putIn(item('wear:hat_s04')) === 'that is in the trade already', 'one item cannot be put into the same trade twice');
  f.t.takeOut(item('wear:hat_s04'));
  const back = did(f, 'offer').pop()!;
  ok(Array.isArray(back.rows) && (back.rows as string[]).length === 0, 'taking it out sends the whole pane again, one row shorter');
  ok(f.t.window!.mine.length === 1, 'and the window does not change until the server says so');
  f.t.setReady(true);
  ok(did(f, 'ready').length === 1 && f.t.window!.youReady === false, 'saying you are happy is a word to the server and nothing more');
  f.state(9, 'Han', ['wear:hat_s04'], [], true, false);
  f.t.setReady(false);
  ok(did(f, 'unready').length === 1, 'and taking it back is the word the server knows for that');
}

// ---- the ways a trade ends, and the rows before and after ------------------------------------------------

{
  // Both sides pull the plug in the middle: this side hears nothing at all, and nothing moves.
  const f = make();
  f.owned.add(thingOf('wear:hat_s04'));
  f.list(['wear:hat_s04']);
  f.state(9, 'Han', ['wear:hat_s04'], ['weapon:baton_stun'], true, false);
  const before = f.lists.length;
  f.t.clear();
  ok(f.t.window === null && f.lists.length === before, 'a line that drops in the middle of a trade moves nothing: the items were never here to move');
  ok(f.t.known === false && f.t.list.length === 0, 'and the server’s list is let go of with it, so local storage is the backpack again');
  f.t.step(0.25);
  ok(f.sent.filter((m) => m.t === 'items' && m.do === 'get').length === 0, 'a dropped line asks the server for nothing: there is nobody there');
}

{
  // A trade that finishes. The rows changed owner on the server, in one step, before this browser
  // heard a word; here it asks for the list and writes the backpack from that and from nothing else.
  const f = make();
  f.list(['wear:hat_s04']);
  f.state(9, 'Han', ['wear:hat_s04'], ['weapon:baton_stun'], true, true);
  const lists = f.lists.length;
  f.t.handle({ t: 'trade', do: 'done', with: 'Han', gave: [row('wear:hat_s04', 'i1')], got: [row('weapon:baton_stun', 'i9')] });
  ok(f.t.window === null && f.lists.length === lists, 'the word "done" says what happened and moves nothing itself');
  ok(f.t.wantsList === true && f.sent.filter((m) => m.t === 'items' && m.do === 'get').length === 1, 'it asks the server for the list instead, which is the only thing that moves anything');
  ok(f.notes.some((n) => n.includes('Han')), 'and it is said in words');
  f.t.handle({ t: 'trade', do: 'done', with: 'Han', gave: [row('wear:hat_s04', 'i1')], got: [row('weapon:baton_stun', 'i9')] });
  ok(f.lists.length === lists, 'the same word arriving twice writes nothing twice: one list, one backpack');
  f.list(['weapon:baton_stun']);
  ok(f.lists.length === lists + 1 && f.t.wantsList === false, 'the list that comes back is what the backpack is written from');
}

{
  // A list asked for and lost: the slow step asks again rather than leaving the backpack stale.
  const f = make();
  f.list(['wear:hat_s04']);
  f.t.sync();
  const asked = f.sent.filter((m) => m.t === 'items' && m.do === 'get').length;
  for (let i = 0; i < TRADE_TUNE.askAgain + 1; i++) f.t.step(0.25);
  ok(f.sent.filter((m) => m.t === 'items' && m.do === 'get').length > asked, 'a list that does not come is asked for again a few seconds later');
  f.list(['wear:hat_s04']);
  const settled = f.sent.filter((m) => m.t === 'items' && m.do === 'get').length;
  for (let i = 0; i < TRADE_TUNE.askAgain + 1; i++) f.t.step(0.25);
  ok(f.sent.filter((m) => m.t === 'items' && m.do === 'get').length === settled, 'and once it has come, nothing is asked for again');
}

{
  const f = make();
  f.list(['wear:hat_s04']);
  f.state(9, 'Han', ['wear:hat_s04'], [], true, false);
  const lists = f.lists.length;
  f.t.handle({ t: 'trade', do: 'off', why: 'Han closed the trade' });
  ok(f.t.window === null && f.lists.length === lists, 'a trade broken off leaves the items exactly where they were');
  ok(f.notes.some((n) => n.includes('Han closed the trade')), 'and says why, in the server’s own words');
  ok(tradeWords('Han', [{ kind: 'wear', id: 'a', got: 0 }], [{ kind: 'weapon', id: 'b', got: 0 }]).includes('Han'), 'a finished trade reads as what changed hands');
}

// ---- words from a stranger --------------------------------------------------------------------------------

{
  const f = make();
  ok(f.t.handle({ t: 'hello' }) === false, 'a word that is not ours is not ours');
  ok(f.t.handle({ t: 'trade', do: 'something new' }) === true && f.t.window === null, 'a word from a newer server is taken and ignored');
  f.t.handle({
    t: 'items',
    do: 'list',
    take: 'server',
    rows: [{ id: 'i1', kind: 'wear', what: '__proto__' }, { id: 'i2', kind: 'wear', what: 'hat_s04', got: 3 }, { id: 'i3', kind: 'wear', what: 'hat_s04', got: 4 }, { id: 'i4', kind: 'nonsense', what: 'x' }, 'not a row', { id: 'i5', what: 'no kind' }],
  });
  const got = f.lists[0].items;
  ok(got.length === 1 && got[0].id === 'hat_s04' && got[0].row === 'i2', 'a list is read rather than trusted: a name that means something to an object, a repeat and anything malformed are all dropped');
  f.t.handle({ t: 'trade', do: 'state', id: 't1', with: 7, yours: { rows: [] }, theirs: { rows: [] } });
  ok(f.t.window === null, 'and a window with this browser on both sides of it is no window at all');
  const handedOver: TradeItem[] = [];
  f.t.onAdded = (item) => void handedOver.push(item);
  f.t.handle({ t: 'items', do: 'added', row: { id: 'i7', kind: 'weapon', what: 'baton_stun', got: 9, thing: 'srv.i7' } });
  ok(f.t.rowOf({ kind: 'weapon', id: 'baton_stun', thing: 'srv.i7' }) === 'i7', 'an item the server has written down is known by its row from then on');
  ok(handedOver.length === 1 && handedOver[0].kind === 'weapon' && handedOver[0].id === 'baton_stun' && handedOver[0].row === 'i7' && handedOver[0].thing === 'srv.i7', 'and one the server wrote down on its own (a job\'s reward, paid through its ledger) is handed on to go in the backpack, its row and its name already known');
  f.t.handle({ t: 'items', do: 'added', row: { id: 'i8', kind: 'nonsense', what: 'x' } });
  ok(handedOver.length === 1, 'while a row that is not one is handed nowhere');
  f.t.handle({ t: 'items', do: 'gone', id: 'i7' });
  ok(f.t.rowOf({ kind: 'weapon', id: 'baton_stun', thing: 'srv.i7' }) === '', 'and one it says is gone is no longer known by any row');
  f.t.handle({ t: 'items', do: 'list', take: 'server', rows: [{ id: 'i1', kind: 'wear', what: 'hat_s04', thing: 'bad name!' }, { id: 'i2', kind: 'wear', what: 'hat_s04', thing: '__proto__' }, { id: 'i3', kind: 'wear', what: 'hat_s04', thing: 'ok|1', tint: { index_color_1: 2, 'no good!': 3 }, tintAt: 7 }] });
  const named = f.lists[f.lists.length - 1].items;
  ok(named.length === 2 && named[0].thing === undefined && named[1].thing === 'ok|1' && named[1].tint?.index_color_1 === 2 && !('no good!' in (named[1].tint ?? {})) && named[1].tintAt === 7, 'a thing\'s name and colours are read rather than trusted too: a name that is not one is no name, and a colour is cleaned to the customizer\'s own');
}

// ---- the rate this side keeps ------------------------------------------------------------------------------

{
  const f = make();
  f.owned.add(thingOf('wear:hat_s04'));
  f.list(['wear:hat_s04']);
  f.state(9, 'Han', [], []);
  let went = 0;
  for (let i = 0; i < TRADE_TUNE.asksPerSecond + 4; i++) if (f.t.putIn(item('wear:hat_s04')) === '') went++;
  ok(went <= TRADE_TUNE.asksPerSecond, `no more words go out in a second than the server will take (${went})`);
  const was = TRADE_TUNE.offerMax;
  ok(tuneTrade({ offerMax: 3 }).offerMax === 3 && tuneTrade({ offerMax: 0 }).offerMax === 1, 'the invented numbers can be set from the console and are held to what makes sense');
  tuneTrade({ offerMax: was });
  ok(Object.isFrozen(GROUP_RANGE), 'the distance a trade reaches is the game’s and cannot be set at all');
  ok(tradeNow() === f.t, 'the one in play is the last one made, which is how the chat line’s /trade finds it');
}

// ---- handing this browser's list up --------------------------------------------------------------------------

{
  const f = make();
  f.t.mine = () => [{ ...item('wear:hat_s04'), got: 9, tint: { index_color_1: 4 }, tintAt: 3 }];
  f.t.tell();
  const told = did(f, 'list').pop()!;
  const rows = told.rows as unknown[][];
  ok(!!told && rows.length === 1 && Array.isArray(rows[0]) && rows[0][0] === 'wear' && rows[0][1] === 'hat_s04' && rows[0][2] === 9, 'the list handed up is the backpack, each row the short array a server that keeps a row per thing reads: kind, catalogue id, when it was got');
  ok(rows[0].length === 4, 'and nothing else: no row id, since those are the server’s to mint and a browser that made one up would be making up an item');
  ok(rows[0][3] === thingOf('wear:hat_s04'), 'each thing goes up under its own name and without its colours, which would not fit a full backpack in the second a server allows it');
  ok(f.t.wantsList === true, 'and this browser is waiting on the answer, which is what it will write itself from');
  f.list(['wear:hat_s04'], 'browser');
  ok(f.lists.pop()!.take === 'browser', 'the answer says which copy stood, which is what marks the record');
  f.t.mine = () => null;
  const before = did(f, 'list').length;
  f.t.tell();
  ok(did(f, 'list').length === before && f.t.wantsList === false, 'with no character in play there is nothing to say, and nothing to wait for');
}

{
  // The server settles a character by the first word it hears about its things, so a bare "give me
  // the list" from a browser whose character it has never held would settle it as owning nothing.
  const f = make();
  f.t.mine = () => [item('wear:hat_s04')];
  f.t.sync();
  ok(did(f, 'get').length === 0 && did(f, 'list').length === 1, 'asking for the list before one has ever come hands this browser’s own list up instead of an empty question');
  f.list(['wear:hat_s04'], 'browser');
  f.t.sync();
  ok(did(f, 'get').length === 1, 'and once the server has answered, asking again is just a question');
}

{
  // Whatever drives `step` has to be started by the ledger itself, because the first list a session
  // waits on is the claim being answered: no window, no question, nothing else to wake it. Without
  // this, a list lost to the server's own rate would never be asked for again and the backpack
  // would be stale in silence for the rest of the session.
  const f = make();
  let woke = 0;
  f.t.onWant = () => woke++;
  f.t.mine = () => [item('wear:hat_s04')];
  f.t.tell();
  ok(woke === 1 && f.t.wantsList === true, 'handing the list up at claim time says that something is being waited on, so the step that asks again is started');
  f.list(['wear:hat_s04'], 'browser');
  f.t.sync();
  ok(woke === 2, 'and so does asking for it again');
}

{
  // A list asked for and lost after a trade leaves this side asking again. The server settles a
  // backpack on either question and settling breaks off whatever that character has in flight, so
  // an ask while a window is open would cancel the next trade from under both players.
  const f = make();
  f.list(['wear:hat_s04']);
  f.state(9, 'Han', [], []);
  f.t.sync();
  for (let i = 0; i < TRADE_TUNE.askAgain + 2; i++) f.t.step(0.25);
  ok(did(f, 'get').length === 0, 'not one word asking for the list goes out while a window is open: it would break the trade off');
  f.t.handle({ t: 'trade', do: 'off', why: 'Han closed the trade' });
  for (let i = 0; i < TRADE_TUNE.askAgain + 2; i++) f.t.step(0.25);
  ok(did(f, 'get').length > 0, 'and the moment the window is gone it is asked for, so nothing is left stale');
}

{
  // The mark the record carries goes up with the list. A browser whose storage was cleared hands an
  // empty list up, and without the mark a server that has never held that character would write the
  // empty list down as the truth: the cache over the server, which is the one forbidden direction.
  const f = make();
  f.t.mine = () => [];
  f.t.mark = () => ({ known: true, rev: 4 });
  f.t.tell();
  const marked = did(f, 'list').pop()!;
  ok(marked.known === 1 && marked.rev === 4, 'a list from a record the server has taken down before says so, and at which counter');
  f.t.mark = () => ({ known: false, rev: 0 });
  f.t.tell();
  const fresh = did(f, 'list').pop()!;
  ok(!('known' in fresh) && !('rev' in fresh), 'and one that has only ever been played alone claims nothing');
}

{
  // `offerMax` is how many things this side lets the player add. The panes are the server's own
  // state and are read whole, or lowering that number from the console would take everything past
  // it back out of the trade the player is looking at.
  const f = make();
  const was = TRADE_TUNE.offerMax;
  tuneTrade({ offerMax: 2 });
  f.state(9, 'Han', ['wear:hat_s04', 'wear:shirt_s03', 'weapon:baton_stun'], []);
  ok(f.t.window!.mine.length === 3, 'what the server says is in a pane is shown whole, whatever this side’s own cap is set to');
  f.owned.add(thingOf('wear:cloak_s01'));
  f.list(['wear:cloak_s01']);
  ok(f.t.putIn(item('wear:cloak_s01')).includes('at a time') && did(f, 'offer').length === 0, 'and the cap is what refuses another one being added');
  tuneTrade({ offerMax: was });
}

// ---- the mark on the record ------------------------------------------------------------------------------------

{
  const rec = { id: 'c1', name: 'Tester', species: 'human_male', class: 'jedi', appearance: { morphs: {}, values: {}, height: 0.5 }, outfit: [], planet: 'tatooine', created: 0, played: 0 } as unknown as SavedCharacter;
  ok(knownToServer(rec) === false && knownToServer(null) === false, 'a character that has only been played alone is not the server’s');
  markKnownToServer(rec, 4);
  ok(knownToServer(rec) === true && rec.rev === 4, 'once a server has taken it down, the record says so and keeps the counter it settled at');
  markKnownToServer(rec, 2);
  ok(rec.rev === 4, 'a word arriving out of order never makes a character look older than it is');
  markKnownToServer(rec, 6);
  ok(rec.rev === 6, 'and a newer one does move it on');
}

// ---- the cache: what a list does to the backpack, the body and the hands --------------------------------------

function equipment(items: { id: string; kind: 'wear' | 'weapon'; got: number; thing?: string }[], worn: string[], hands: { right?: string; left?: string }) {
  const log: string[] = [];
  const wornMap = new Map<string, boolean>(worn.map((w) => [w, true]));
  const wardrobe = {
    species: 'human',
    gender: 'male',
    items: [
      { id: 'shirt_s03', kind: 'wearables', gender: 'm', template: 'x', parts: [{ name: 'shirt_s03', file: 'a.glb', triangles: 1, occlusionLayer: 2 }], name: 'Plain Shirt', slots: [['chest1']] },
      { id: 'hat_s04', kind: 'wearables', gender: 'm', template: 'x', parts: [{ name: 'hat_s04', file: 'b.glb', triangles: 1, occlusionLayer: 2 }], name: 'Hat', slots: [['hat']] },
    ],
  };
  const player = {
    equipped: { right: null as { id: string; class: string } | null, left: null as { id: string; class: string } | null },
    saberOn: false,
    equip() {
      return 'jedi';
    },
    unequip(hand: 'right' | 'left') {
      log.push(`unequip(${hand})`);
      this.equipped[hand] = null;
    },
    toggleSaber() {},
  };
  if (hands.right) player.equipped.right = { id: hands.right, class: 'sword1h' };
  if (hands.left) player.equipped.left = { id: hands.left, class: 'sword1h' };
  const character = {
    manifest: { id: 'human_male' },
    wardrobeDir: '/w/',
    packParts: [] as string[],
    customizer: { settled: () => Promise.resolve() },
    status: () => [{ name: 'body', worn: true, body: true }, ...[...wornMap].map(([name, on]) => ({ name, worn: on, body: false }))],
    catalogue: async () => wardrobe,
    packPartOf: () => null,
    loadPiece: async () => ({ found: true, meshes: [] }),
    putOn: (on: string[], off: string[]) => {
      log.push(`putOn([${on.join(',')}],[${off.join(',')}])`);
      for (const k of off) wornMap.set(k, false);
      for (const k of on) wornMap.set(k, true);
    },
  };
  // Every row has a name, as a record read in through `load` has; one given none is named by its key.
  const record: { items: { id: string; kind: 'wear' | 'weapon'; got: number; thing?: string }[] } & Record<string, unknown> = { id: 'c1', name: 'Tester', species: 'human_male', class: 'jedi', appearance: { morphs: {}, values: {}, height: 0.5 }, outfit: [...worn], planet: 'tatooine', created: 0, played: 0, items: items.map((o) => ({ ...o, thing: o.thing ?? thingOf(`${o.kind}:${o.id}`) })), inv: 1 as const, named: 1 as const };
  const told: string[] = [];
  const changed: string[] = [];
  const deps = {
    character: () => character,
    player,
    weaponsLoaded: async () => ({ weapons: [{ id: 'baton_stun', class: 'sword1h', slots: [['hold_r']], name: 'Stun Baton' }], model: async () => ({}), iconUrl: () => null }),
    prepare: async () => {},
    record: () => record,
    persist: () => log.push('persist'),
    changed: (what: string) => changed.push(what),
    ledger: (what: string, item: { kind: string; id: string; thing?: string }) => told.push(`${what}:${item.kind}:${item.id}`),
    baseUrl: '/',
  } as unknown as EquipmentDeps;
  return { eq: new Equipment(deps), record, worn: wornMap, player, log, told, changed };
}

{
  const w = equipment(
    [
      { id: 'hat_s04', kind: 'wear', got: 1 },
      { id: 'shirt_s03', kind: 'wear', got: 2 },
      { id: 'baton_stun', kind: 'weapon', got: 3 },
    ],
    ['shirt_s03'],
    { right: 'baton_stun' },
  );
  await w.eq.itemContext();
  const hat = thingOf('wear:hat_s04');
  ok(w.eq.owns(hat) && !w.eq.owns(thingOf('wear:robe_jedi_padawan')), 'the equipment says what is owned, by each thing\'s name, which is what a trade asks before it offers anything');
  ok(w.eq.inUse(thingOf('wear:shirt_s03')) === 'worn' && w.eq.inUse(thingOf('weapon:baton_stun')) === 'right' && w.eq.inUse(hat) === null, 'and what each one is doing, read from the body and the hands rather than from the record');

  // The server says the shirt and the baton have gone: both come off, in the same step, and the
  // backpack is written from the server's list and from nothing else.
  const note = await w.eq.reconcile([{ id: 'hat_s04', kind: 'wear', got: 1, thing: hat }]);
  await tick();
  ok(note === reconcileWords(0, 2), `a list that is two rows shorter says so (${note})`);
  ok(w.record.items!.length === 1 && w.record.items![0].id === 'hat_s04', 'the record holds exactly the server’s list afterwards');
  ok(w.worn.get('shirt_s03') === false, 'a shirt traded away comes off the body');
  ok(w.player.equipped.right === null, 'and a weapon traded away comes out of the hand');
  ok(!w.record.items!.some((o) => o.id === 'shirt_s03' || o.id === 'baton_stun'), 'neither is given back by the save that follows, which is the one way a traded item could come home');
  ok(w.told.length === 0, 'and nothing is sent back to the server about it: the server is where it came from');
  const same = await w.eq.reconcile([{ id: 'hat_s04', kind: 'wear', got: 1, thing: hat }]);
  ok(same === 'nothing in the backpack changed' && w.record.items!.length === 1 && w.record.items![0].thing === hat, 'the same list again changes nothing at all, the name included');
}

{
  // The other direction: what the server has and this browser has not.
  const w = equipment([], [], {});
  await w.eq.itemContext();
  const note = await w.eq.reconcile([
    { id: 'hat_s04', kind: 'wear', got: 1, thing: 'srv.i1' },
    { id: 'baton_stun', kind: 'weapon', got: 2, thing: 'srv.i2' },
  ]);
  ok(note === reconcileWords(2, 0) && w.record.items!.length === 2, `a browser whose storage was cleared is given everything back (${note})`);
  ok(w.record.items!.map((o) => o.thing).join() === 'srv.i1,srv.i2', 'under the names the server keeps them by: nothing is minted');
  ok(w.told.length === 0, 'and says nothing about any of it, so a list cannot echo back as two dozen new items');
  ok(w.changed.includes('owned'), 'the panels are told once');
}

{
  // What the browser does say: an item it gave itself, and one it destroyed.
  const w = equipment([{ id: 'hat_s04', kind: 'wear', got: 1 }], [], {});
  await w.eq.itemContext();
  w.eq.give('weapon', 'baton_stun');
  ok(w.told.includes('add:weapon:baton_stun'), 'an item given here is told to the ledger');
  await w.eq.destroy('wear', 'hat_s04');
  ok(w.told.includes('drop:wear:hat_s04'), 'and so is one destroyed here');
}

// ---- two of one item: the rows, the pairing, a destroy and an answer said twice --------------------------------

{
  // Two of a kind are two rows, each with its own server id, as the server sends them.
  const f = make();
  f.list(['wear:shirt_s03', 'wear:shirt_s03#2', 'wear:hat_s04']);
  ok(f.t.list.length === 3 && f.lists[0].items.filter((o) => o.id === 'shirt_s03').length === 2, 'two of one shirt in a server\'s list are two rows here');
  ok(f.t.rowOf(item('wear:shirt_s03')) !== f.t.rowOf(item('wear:shirt_s03#2')) && f.t.rowOf(item('wear:shirt_s03#2')) === f.idOf('wear:shirt_s03#2'), 'each known by its own row, so either can be offered or dropped');
  for (const key of ['wear:shirt_s03', 'wear:shirt_s03#2']) f.owned.add(thingOf(key));
  f.using.set(thingOf('wear:shirt_s03'), 'worn');
  f.state(9, 'Han', [], []);
  ok(f.t.putIn(item('wear:shirt_s03')).includes('wearing') && f.t.putIn(item('wear:shirt_s03#2')) === '', 'the copy on the body is refused and the other goes in');
  ok((did(f, 'offer').pop()!.rows as string[]).join() === f.idOf('wear:shirt_s03#2'), 'by that copy\'s own row');
  f.state(9, 'Han', ['wear:shirt_s03#2'], []);
  ok(f.t.offered(item('wear:shirt_s03#2')) && !f.t.offered(item('wear:shirt_s03')), 'and only that copy reads as in the trade');
}

{
  // A server that names things said `added` twice for one thing: one row here, and one in the backpack.
  const w = equipment([], [], {});
  await w.eq.itemContext();
  const f = make();
  f.list([]);
  const came: Promise<boolean>[] = [];
  f.t.onAdded = (it) => void came.push(w.eq.receive(it));
  const word = { t: 'items', do: 'added', row: { id: 'i40', kind: 'weapon', what: 'baton_stun', got: 3, thing: 'srv.i40' } };
  f.t.handle(word);
  f.t.handle(word);
  await Promise.all(came);
  ok(f.t.list.length === 1 && w.record.items!.length === 1 && w.record.items![0].thing === 'srv.i40', 'a word that arrives twice adds once, here and in the backpack');
  ok(w.told.length === 0, 'and nothing is said back about a thing the server gave');
}

{
  // Pairing a server that names nothing -- the relay before this one -- with the backpack it was handed:
  // nothing taken off the body, nothing made, the names this browser gave its things kept.
  const w = equipment(
    [
      { id: 'shirt_s03', kind: 'wear', got: 1, thing: 'mine|1' },
      { id: 'hat_s04', kind: 'wear', got: 2, thing: 'mine|2' },
    ],
    ['shirt_s03'],
    {},
  );
  await w.eq.itemContext();
  const note = await w.eq.reconcile([
    { id: 'shirt_s03', kind: 'wear', got: 1 },
    { id: 'hat_s04', kind: 'wear', got: 2 },
  ]);
  ok(note === 'nothing in the backpack changed' && w.record.items!.map((o) => o.thing).join() === 'mine|1,mine|2', `a list that names nothing is paired by what each is, and the names here are kept (${note})`);
  ok(w.worn.get('shirt_s03') === true && w.told.length === 0, 'nothing comes off and nothing is said');
  // And a server that names its things renames this browser's, oldest with oldest, with no copy made or lost.
  const renamed = await w.eq.reconcile([
    { id: 'shirt_s03', kind: 'wear', got: 1, thing: 'srv.i1' },
    { id: 'hat_s04', kind: 'wear', got: 2, thing: 'srv.i2' },
  ]);
  ok(renamed === 'nothing in the backpack changed' && w.record.items!.map((o) => o.thing).join() === 'srv.i1,srv.i2', 'a server that names its things gives its names to the same things, and nothing came or went');
  ok(w.eq.inUse('srv.i1') === 'worn', 'and the shirt on the body is the same shirt under its new name');
}

{
  // Destroying one of two drops exactly that row, here and on the server.
  const w = equipment(
    [
      { id: 'hat_s04', kind: 'wear', got: 1, thing: thingOf('wear:hat_s04') },
      { id: 'hat_s04', kind: 'wear', got: 2, thing: thingOf('wear:hat_s04#2') },
    ],
    [],
    {},
  );
  await w.eq.itemContext();
  const f = make();
  f.list(['wear:hat_s04', 'wear:hat_s04#2']);
  (w.eq as unknown as { deps: { ledger: unknown } }).deps.ledger = (what: string, it: TradeItem) => (what === 'drop' ? f.t.noteDropped(it) : f.t.noteAdded(it));
  await w.eq.destroy('wear', 'hat_s04', thingOf('wear:hat_s04#2'));
  const drops = did(f, 'drop');
  ok(drops.length === 1 && drops[0].id === f.idOf('wear:hat_s04#2'), 'destroying one of two names that one row to the server');
  ok(w.record.items!.length === 1 && w.record.items![0].thing === thingOf('wear:hat_s04'), 'and the other is still in the backpack');
}

{
  // One of two traded away, which is what this wave is for: the server's list keeps the other, and the
  // copy on the body and the copy in the hand stay where they are.
  const w = equipment(
    [
      { id: 'shirt_s03', kind: 'wear', got: 1, thing: 'a1' },
      { id: 'shirt_s03', kind: 'wear', got: 2, thing: 'a2' },
      { id: 'baton_stun', kind: 'weapon', got: 3, thing: 'b1' },
      { id: 'baton_stun', kind: 'weapon', got: 4, thing: 'b2' },
    ],
    ['shirt_s03'],
    { right: 'baton_stun' },
  );
  await w.eq.itemContext();
  ok(w.eq.inUse('a1') === 'worn' && w.eq.inUse('a2') === null && w.eq.inUse('b1') === 'right' && w.eq.inUse('b2') === null, 'of two shirts and two batons the oldest of each is the one in use');
  const note = await w.eq.reconcile([
    { id: 'shirt_s03', kind: 'wear', got: 1, thing: 'a1' },
    { id: 'baton_stun', kind: 'weapon', got: 3, thing: 'b1' },
  ]);
  ok(note === reconcileWords(0, 2), `the list says the two that went went (${note})`);
  ok(w.worn.get('shirt_s03') === true && !w.log.includes('putOn([],[shirt_s03])'), 'and the shirt still owned stays on the body: the one that left was the other');
  ok(w.player.equipped.right?.id === 'baton_stun' && !w.log.includes('unequip(right)'), 'as the baton still owned stays in the hand');
  ok(w.eq.inUse('a1') === 'worn' && w.eq.inUse('b1') === 'right' && w.record.items!.map((o) => o.thing).join() === 'a1,b1', 'each the copy that is left, and the backpack the server\'s two');
}

{
  // The copy that went was the one the record chose to wear: another is still owned, so the piece stays
  // on and that other copy is the one worn now. Only when no copy is left does it come off.
  const w = equipment(
    [
      { id: 'shirt_s03', kind: 'wear', got: 1, thing: 'a1' },
      { id: 'shirt_s03', kind: 'wear', got: 2, thing: 'a2' },
    ],
    ['shirt_s03'],
    {},
  );
  w.record.wornThings = { shirt_s03: 'a2' };
  await w.eq.itemContext();
  ok(w.eq.inUse('a2') === 'worn' && w.eq.inUse('a1') === null, 'the record\'s choice is the copy worn');
  await w.eq.reconcile([{ id: 'shirt_s03', kind: 'wear', got: 1, thing: 'a1' }]);
  ok(w.worn.get('shirt_s03') === true && w.eq.inUse('a1') === 'worn' && w.record.wornThings === undefined, 'with it gone the shirt stays on, the copy left is the one worn, and the choice naming a thing no longer owned is let go');
  await w.eq.reconcile([]);
  ok(w.worn.get('shirt_s03') === false && w.record.items!.length === 0, 'and with no copy left at all it comes off');
}

{
  // A server from before things had names: one of each goes up, the player is told why, a second is
  // never named to it, and no colour is sent at all.
  const f = make('server', 7, 0);
  f.t.mine = () => [item('wear:shirt_s03'), item('wear:shirt_s03#2'), item('wear:hat_s04')];
  f.t.tell();
  const up = did(f, 'list').pop()!.rows as { what: string; thing?: string }[];
  ok(up.length === 2 && up.filter((r) => r.what === 'shirt_s03').length === 1, 'against a server that folds two of one item into one, one of each goes up');
  ok(up.every((r) => !Array.isArray(r) && typeof r === 'object' && r.thing === undefined), 'as the objects it has always read, naming nothing it would not keep');
  ok(f.notes.some((n) => n.includes('npm run relay')), 'and the player is told to restart it');
  f.list(['wear:shirt_s03', 'wear:hat_s04']);
  ok(f.t.rowOf(item('wear:shirt_s03#2')) === f.t.rowOf(item('wear:shirt_s03')) && f.t.rowOf(item('wear:shirt_s03')) !== '', 'its rows name nothing and are found by what each is, the one row of each it holds');
  const before = f.sent.length;
  f.t.noteAdded(item('wear:shirt_s03#3'));
  ok(f.sent.length === before, 'a second of something it already holds is not named to it: it would only fold it');
  ok(f.t.noteTint(thingOf('wear:shirt_s03'), { index_color_1: 3 }, 5) === false && f.sent.length === before, 'and no colour is sent to a server with nowhere to put one');
  f.t.noteAdded(item('wear:boots_s03'));
  ok(did(f, 'add').length === 1 && did(f, 'add')[0].what === 'boots_s03', 'while something new to it still goes');
}

{
  // A colour, to a server that keeps a row per thing: by the thing's own row.
  const f = make();
  f.list(['wear:hat_s04']);
  ok(f.t.noteTint(thingOf('wear:hat_s04'), { index_color_1: 6 }, 123) === true, 'a colour goes to a server that keeps a row per thing');
  const word = did(f, 'tint').pop()!;
  ok(word.id === f.idOf('wear:hat_s04') && (word.tint as Record<string, number>).index_color_1 === 6 && word.at === 123, 'by the thing\'s own row, with when it was set');
  f.t.noteTint(thingOf('wear:hat_s04'), null, 124);
  ok(did(f, 'tint').pop()!.tint === null, 'and taking it off says null');
  f.at(2_000_000);
  f.t.noteTint(thingOf('wear:hat_s04'), { index_color_1: 7 }, 2_000_000 + 3 * 3600 * 1000);
  ok(did(f, 'tint').pop()!.at === 2_000_000, 'a colour stamped by a clock running fast goes up as set now on the server\'s clock, so it cannot hold the thing against every colour after it');
  ok(f.t.noteTint('never|1', { index_color_1: 1 }, 1) === false, 'a thing the server has not written down has no row to colour');
  ok(f.t.debug().itemsVersion === 2, 'the console says what the server keeps');
}

{
  // A second copy given in play goes to a server that keeps a row per thing as an add naming that thing,
  // or the server would take it for one it already has and make nothing, and the next list take it away.
  const f = make();
  f.list(['wear:shirt_s03']);
  f.t.noteAdded(item('wear:shirt_s03#2'));
  const add = did(f, 'add').pop();
  ok(!!add && add.what === 'shirt_s03' && add.kind === 'wear' && add.thing === thingOf('wear:shirt_s03#2'), 'a second shirt given here goes to the server under its own name');
  f.t.noteAdded(item('wear:shirt_s03'));
  ok(did(f, 'add').length === 1, 'while the first, which the server already holds by its name, is not told again');
}

// ---- end to end: a whole trade, counting the rows ---------------------------------------------------------------

{
  const w = equipment(
    [
      { id: 'hat_s04', kind: 'wear', got: 1 },
      { id: 'baton_stun', kind: 'weapon', got: 2 },
    ],
    [],
    {},
  );
  await w.eq.itemContext();
  const f = make();
  f.t.owns = (thing) => w.eq.owns(thing);
  f.t.inUse = (thing) => w.eq.inUse(thing);
  f.t.using = () => ({ worn: [], held: [] });
  f.t.onList = (items) => void w.eq.reconcile(items);
  f.places.set(9, [0, 0, 3]);
  const before = w.record.items!.length;
  ok(f.t.askTrade(9, 'Han') === '', 'standing beside them, the asking goes out');
  f.list(['wear:hat_s04', 'weapon:baton_stun']);
  await tick();
  f.state(9, 'Han', [], []);
  ok(f.t.putIn(item('wear:hat_s04')) === '', 'a hat in the backpack goes in');
  f.state(9, 'Han', ['wear:hat_s04'], ['weapon:pistol_cdef']);
  f.t.setReady(true);
  f.state(9, 'Han', ['wear:hat_s04'], ['weapon:pistol_cdef'], true, false);
  ok(w.record.items!.length === before, 'while the window is open the backpack has not moved at all');
  f.state(9, 'Han', ['wear:hat_s04'], ['weapon:pistol_cdef'], true, true);
  // The server moves both rows in one step and says so; the list that follows is what is written.
  f.t.handle({ t: 'trade', do: 'done', with: 'Han', gave: [row('wear:hat_s04', 'i1')], got: [row('weapon:pistol_cdef', 'i9')] });
  await tick();
  ok(w.record.items!.length === before, 'and it has still not moved when the word "done" arrives on its own');
  f.list(['weapon:baton_stun', 'weapon:pistol_cdef']);
  await tick();
  await tick();
  const ids = w.record.items!.map((o) => `${o.kind}:${o.id}`).sort();
  ok(ids.join(',') === 'weapon:baton_stun,weapon:pistol_cdef', `the backpack afterwards is the server’s list, no more and no less (${ids.join(',')})`);
  ok(w.record.items!.length === before, 'one thing in, one thing out: nothing was made and nothing was lost');
  ok(f.t.window === null, 'and the window is gone');
}

console.log(`\n${checks} checks passed`);
