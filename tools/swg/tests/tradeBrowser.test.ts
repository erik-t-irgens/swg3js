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

/** `wear:hat_s04` as the server sends a row of it: its own id, the kind, the catalogue id. */
function row(key: string, id: string) {
  const i = key.indexOf(':');
  return { id, kind: key.slice(0, i), what: key.slice(i + 1), got: 5 };
}

function make(authority: 'me' | 'server' = 'server', me = 7) {
  const sent: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const lists: { items: TradeItem[]; take: string }[] = [];
  const windows: (null | { mine: number; theirs: number; you: boolean; them: boolean })[] = [];
  const places = new Map<number, [number, number, number]>();
  const owned = new Set<string>();
  const using = new Map<string, 'worn' | 'right' | 'left'>();
  /** The row id the make-believe server has minted for each thing. */
  const ids = new Map<string, string>();
  let next = 1;
  let clock = 1_000_000;
  const t = new Trade(() => clock / 1000);
  t.authority = () => authority;
  t.selfId = () => me;
  t.serverNow = () => clock;
  t.send = (msg) => void sent.push(msg);
  t.onNote = (text) => void notes.push(text);
  t.onList = (items, take) => void lists.push({ items, take });
  t.onWindow = (w) => void windows.push(w ? { mine: w.mine.length, theirs: w.theirs.length, you: w.youReady, them: w.themReady } : null);
  t.owns = (kind, id) => owned.has(`${kind}:${id}`);
  t.inUse = (kind, id) => using.get(`${kind}:${id}`) ?? null;
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
  const idOf = (key: string) => {
    let id = ids.get(key);
    if (!id) {
      id = `i${next++}`;
      ids.set(key, id);
    }
    return id;
  };
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
      t.handle({ t: 'items', do: 'list', take, rows: keys.map((key) => row(key, idOf(key))) });
    },
    /** The server's own `trade state`, from this side's end. */
    state(withId: number, name: string, mine: string[], theirs: string[], you = false, them = false) {
      t.handle({
        t: 'trade',
        do: 'state',
        id: 't1',
        with: withId,
        name,
        yours: { rows: mine.map((key) => row(key, idOf(key))), ready: you ? 1 : 0 },
        theirs: { rows: theirs.map((key) => row(key, idOf(key))), ready: them ? 1 : 0 },
      });
    },
  };
}

type Fake = ReturnType<typeof make>;

const did = (f: Fake, what: string) => f.sent.filter((m) => m.do === what);

// ---- with no server, nothing at all ----------------------------------------------------------------

{
  const f = make('me');
  f.owned.add('weapon:baton_stun');
  f.t.mine = () => [{ kind: 'weapon', id: 'baton_stun', got: 1 }];
  f.t.using = () => ({ worn: [], held: [] });
  ok(f.t.active === false, 'with no server the ledger is not active');
  ok(f.t.askTrade(9, 'han') !== '' && f.sent.length === 0, 'asking to trade sends nothing and says why');
  f.t.accept();
  f.t.decline();
  f.t.cancel();
  f.t.sync();
  f.t.tell();
  f.t.tellUsing();
  f.t.noteAdded('weapon', 'baton_stun');
  f.t.noteDropped('weapon', 'baton_stun');
  f.t.step(0.25);
  ok(f.sent.length === 0, 'not one word about items or trading goes out: the game played alone is the game it was');
  ok(f.t.putIn('weapon', 'baton_stun') === 'there is no trade open', 'nothing can be put into a trade that does not exist');
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
  for (const key of ['weapon:baton_stun', 'wear:shirt_s03', 'wear:hat_s04']) f.owned.add(key);
  f.t.using = () => ({ worn: [{ kind: 'wear', id: 'shirt_s03', got: 0 }], held: [{ kind: 'weapon', id: 'baton_stun', got: 0 }] });
  f.using.set('wear:shirt_s03', 'worn');
  f.using.set('weapon:baton_stun', 'right');
  f.list(['weapon:baton_stun', 'wear:shirt_s03', 'wear:hat_s04']);
  const told = did(f, 'using').pop()!;
  ok(!!told && (told.worn as string[]).length === 1 && (told.held as string[]).length === 1, 'a list arriving is when the server is told what is worn and held, by its own row ids');
  f.state(9, 'Han', [], []);
  ok(f.t.window?.name === 'Han', 'the window is what the server said it is');
  const worn = f.t.putIn('wear', 'shirt_s03');
  ok(worn.includes('wearing') && did(f, 'offer').length === 0, `something being worn is refused in words, not dropped in silence (${worn})`);
  const held = f.t.putIn('weapon', 'baton_stun');
  ok(held.includes('right hand') && did(f, 'offer').length === 0, `and so is something in a hand (${held})`);
  ok(f.t.putIn('wear', 'robe_jedi_padawan') === 'you do not own that', 'what is not owned cannot be offered');
  f.owned.add('wear:cloak_s01');
  ok(f.t.putIn('wear', 'cloak_s01') === 'the server has not written that one down yet', 'and neither can something the server has no row for: an offer names the server’s own row');
  ok(f.t.putIn('wear', 'hat_s04') === '' && did(f, 'offer').length === 1, 'what is owned, free and written down goes over');
  const offer = did(f, 'offer')[0];
  ok(Array.isArray(offer.rows) && (offer.rows as string[])[0] === f.idOf('wear:hat_s04'), 'by the row id the server minted, and never by anything this browser made up');
  ok(f.t.window!.mine.length === 0, 'and still nothing is in the window: only the server puts it there');
  const drawn = f.windows.length;
  f.state(9, 'Han', ['wear:hat_s04'], []);
  ok(f.t.window!.mine.length === 1 && f.t.offered('wear', 'hat_s04'), 'the server says what is in, and then it is in');
  ok(f.windows.length === drawn + 1 && f.windows.pop()!.mine === 1, 'and the panel is told every time it moves, not only when a window opens and closes');
  ok(f.t.putIn('wear', 'hat_s04') === 'that is in the trade already', 'one item cannot be put into the same trade twice');
  f.t.takeOut('wear', 'hat_s04');
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
  f.owned.add('wear:hat_s04');
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
  f.t.handle({ t: 'items', do: 'added', row: { id: 'i7', kind: 'weapon', what: 'baton_stun', got: 9 } });
  ok(f.t.rowOf('weapon', 'baton_stun') === 'i7', 'an item the server has written down is known by its row from then on');
  f.t.handle({ t: 'items', do: 'gone', id: 'i7' });
  ok(f.t.rowOf('weapon', 'baton_stun') === '', 'and one it says is gone is no longer known by any row');
}

// ---- the rate this side keeps ------------------------------------------------------------------------------

{
  const f = make();
  f.owned.add('wear:hat_s04');
  f.list(['wear:hat_s04']);
  f.state(9, 'Han', [], []);
  let went = 0;
  for (let i = 0; i < TRADE_TUNE.asksPerSecond + 4; i++) if (f.t.putIn('wear', 'hat_s04') === '') went++;
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
  f.t.mine = () => [{ kind: 'wear', id: 'hat_s04', got: 9 }];
  f.t.tell();
  const told = did(f, 'list').pop()!;
  const rows = told.rows as { kind: string; what: string; got: number }[];
  ok(!!told && rows.length === 1 && rows[0].what === 'hat_s04' && rows[0].kind === 'wear', 'the list handed up is the backpack in the server’s own shape');
  ok(!('id' in rows[0]), 'and carries no row ids: they are the server’s to mint, and a browser that made one up would be making up an item');
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
  f.t.mine = () => [{ kind: 'wear', id: 'hat_s04', got: 9 }];
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
  f.t.mine = () => [{ kind: 'wear', id: 'hat_s04', got: 9 }];
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
  f.owned.add('wear:cloak_s01');
  f.list(['wear:cloak_s01']);
  ok(f.t.putIn('wear', 'cloak_s01').includes('at a time') && did(f, 'offer').length === 0, 'and the cap is what refuses another one being added');
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

function equipment(items: { id: string; kind: 'wear' | 'weapon'; got: number }[], worn: string[], hands: { right?: string; left?: string }) {
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
  const record = { id: 'c1', name: 'Tester', species: 'human_male', class: 'jedi', appearance: { morphs: {}, values: {}, height: 0.5 }, outfit: [...worn], planet: 'tatooine', created: 0, played: 0, items: [...items], inv: 1 as const };
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
    ledger: (what: string, kind: string, id: string) => told.push(`${what}:${kind}:${id}`),
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
  ok(w.eq.owns('wear', 'hat_s04') && !w.eq.owns('wear', 'robe_jedi_padawan'), 'the equipment says what is owned, which is what a trade asks before it offers anything');
  ok(w.eq.inUse('wear', 'shirt_s03') === 'worn' && w.eq.inUse('weapon', 'baton_stun') === 'right' && w.eq.inUse('wear', 'hat_s04') === null, 'and what each one is doing, read from the body and the hands rather than from the record');

  // The server says the shirt and the baton have gone: both come off, in the same step, and the
  // backpack is written from the server's list and from nothing else.
  const note = await w.eq.reconcile([{ id: 'hat_s04', kind: 'wear', got: 1 }]);
  await tick();
  ok(note === reconcileWords(0, 2), `a list that is two rows shorter says so (${note})`);
  ok(w.record.items!.length === 1 && w.record.items![0].id === 'hat_s04', 'the record holds exactly the server’s list afterwards');
  ok(w.worn.get('shirt_s03') === false, 'a shirt traded away comes off the body');
  ok(w.player.equipped.right === null, 'and a weapon traded away comes out of the hand');
  ok(!w.record.items!.some((o) => o.id === 'shirt_s03' || o.id === 'baton_stun'), 'neither is given back by the save that follows, which is the one way a traded item could come home');
  ok(w.told.length === 0, 'and nothing is sent back to the server about it: the server is where it came from');
  const same = await w.eq.reconcile([{ id: 'hat_s04', kind: 'wear', got: 1 }]);
  ok(same === 'nothing in the backpack changed' && w.record.items!.length === 1, 'the same list again changes nothing at all');
}

{
  // The other direction: what the server has and this browser has not.
  const w = equipment([], [], {});
  await w.eq.itemContext();
  const note = await w.eq.reconcile([
    { id: 'hat_s04', kind: 'wear', got: 1 },
    { id: 'baton_stun', kind: 'weapon', got: 2 },
  ]);
  ok(note === reconcileWords(2, 0) && w.record.items!.length === 2, `a browser whose storage was cleared is given everything back (${note})`);
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
  f.t.owns = (kind, id) => w.eq.owns(kind, id);
  f.t.inUse = (kind, id) => w.eq.inUse(kind, id);
  f.t.using = () => ({ worn: [], held: [] });
  f.t.onList = (items) => void w.eq.reconcile(items);
  f.places.set(9, [0, 0, 3]);
  const before = w.record.items!.length;
  ok(f.t.askTrade(9, 'Han') === '', 'standing beside them, the asking goes out');
  f.list(['wear:hat_s04', 'weapon:baton_stun']);
  await tick();
  f.state(9, 'Han', [], []);
  ok(f.t.putIn('wear', 'hat_s04') === '', 'a hat in the backpack goes in');
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
