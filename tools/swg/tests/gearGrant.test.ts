// The grapple's rig as a thing a character owns (the design's §6, wave 4): given once where this browser keeps the
// character's things, by a mark of its own written in the same save as the row and read back through `normalizeOwned`;
// decided by a server's own first list where the server says its ledger keeps gear, asked for when that list has none
// and never when it has one, a rig given offline before that server asked for again rather than lost; never handed up
// to a server that does not say it keeps gear and never taken away by such a server's list; and traded from one
// character to another through the real `Trade` and the real ledger, as anything owned is.
//
// Everything is the game's own code -- `Equipment`, `Trade`, `Ledger` -- wired the way `main.ts` and `relay.mjs` wire
// them, with a few lines of make-believe relay between them and no socket. Synthetic characters only.
//
// Run: node tools/swg/tests/gearGrant.test.ts
import assert from 'node:assert/strict';
import { GRAPPLE_RIG, normalizeOwned, type OwnedItem } from '../../../src/core/inventory.ts';
import { Equipment, type EquipmentDeps } from '../../../src/player/equipment.ts';
import { Trade, type TradeItem } from '../../../src/net/trade.ts';
import { Session, type SessionStore } from '../../../src/net/session.ts';
import { LEDGER_TUNING, Ledger, cleanItems, cleanTrade } from '../../../server/ledger.mjs';
import { applyChange, emptyWorld } from '../../../server/store.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const rigs = (items: readonly { kind: string; id: string }[] | undefined) => (items ?? []).filter((o) => o.kind === 'gear' && o.id === GRAPPLE_RIG).length;

type Rec = { id: string; name: string; species: string; class: 'jedi'; outfit: string[]; appearance: { morphs: Record<string, number>; values: Record<string, number>; height: number }; planet: string; created: number; played: number; inv?: 1; named?: 1; items?: OwnedItem[]; gear?: 1 };
const record = (id: string, items: OwnedItem[] = []): Rec => ({ id, name: id, species: 'human_male', class: 'jedi', outfit: [], appearance: { morphs: {}, values: {}, height: 0.5 }, planet: 'tatooine', created: 0, played: 0, inv: 1, named: 1, items });
const shirt = (n = 1): OwnedItem => ({ id: 'shirt_s03', kind: 'wear', got: 10 + n, thing: `wshirt_s03|${n}|aa` });

/**
 * One browser's equipment over a record: who keeps its gear (`here`, or a server that says it keeps gear), every save
 * kept as the JSON written, and what it told the ledger.
 */
function browser(rec: Rec, opts: { keeper: Keeper | (() => Keeper); keeps?: (kind: string) => boolean; trade?: Trade | null; rewritten?: (was: Rec, now: Rec) => void }) {
  const saves: string[] = [];
  const keeper = opts.keeper;
  const player = { equipped: { right: null, left: null }, saberOn: false, unequip() {}, toggleSaber() {}, equip() { return null; } };
  const deps = {
    character: () => null,
    player,
    weaponsLoaded: async () => null,
    prepare: async () => {},
    record: () => rec,
    persist: (c: Rec) => void saves.push(JSON.stringify(c)),
    changed: () => {},
    ledger: (what: 'add' | 'drop', item: OwnedItem) => {
      const t = opts.trade;
      if (!t) return;
      const it: TradeItem = { kind: item.kind, id: item.id, got: item.got, thing: item.thing };
      if (what === 'add') t.noteAdded(it);
      else t.noteDropped(it);
    },
    gearKeeper: () => (typeof keeper === 'function' ? keeper() : keeper),
    keeps: opts.keeps,
    rewritten: opts.rewritten,
    baseUrl: '/',
  } as unknown as EquipmentDeps;
  return { eq: new Equipment(deps), saves };
}

type Keeper = 'here' | 'server' | 'pending';

/** A browser's storage in a plain object, for a real `Session`'s change counters. */
function memStore(): SessionStore {
  const data: Record<string, string> = {};
  return { get: (k) => (k in data ? data[k] : null), set: (k, v) => void (data[k] = v) };
}
const ABOUT = { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' };

/** A trade half wired as `main.ts` wires it, its server list laid over the backpack and, where gear is kept, the rig decided. */
function tradeFor(rec: () => Rec, eq: () => Equipment, opts: { gear: boolean; send: (msg: Record<string, unknown>) => void; words?: string[] }) {
  const t = new Trade(() => Date.now() / 1000);
  t.authority = () => 'server';
  t.itemsVersion = () => 2;
  t.keeps = (kind) => kind !== 'gear' || opts.gear;
  t.send = opts.send;
  t.owns = (thing) => eq().owns(thing);
  t.inUse = (thing) => eq().inUse(thing);
  t.mine = () => (rec().items ?? []).map((o) => ({ kind: o.kind, id: o.id, got: o.got, thing: o.thing }));
  t.mark = () => null;
  t.using = () => ({ worn: [], held: [] });
  t.onList = (items) => {
    void eq().reconcile(items).then((w) => void opts.words?.push(w));
    if (opts.gear) void eq().gearFromList(items);
  };
  t.onAdded = (item) => void eq().receive(item);
  return t;
}

// --- 1. With no server: once, by its own mark, in one save, through `normalizeOwned` -----------------------------
{
  const rec = record('c-alone', [shirt()]);
  const b = browser(rec, { keeper: 'here' });
  await b.eq.load(rec as never);
  ok(rigs(rec.items) === 1 && rec.gear === 1, 'a character this browser keeps is given one rig, and marked as given');
  ok(b.saves.length === 1, 'in one save');
  const saved = JSON.parse(b.saves[0]) as Rec;
  ok(saved.gear === 1 && rigs(saved.items) === 1, 'the row and the mark are written together: a save holding one holds the other');
  ok(rigs(normalizeOwned(saved.items)) === 1, 'and a reload read through normalizeOwned, never around it, still holds exactly one');
  const again = browser(saved, { keeper: 'here' });
  await again.eq.load(saved as never);
  ok(rigs(saved.items) === 1 && again.saves.length === 0, 'a second load gives no second rig and saves nothing');
  ok((await again.eq.destroy('gear', GRAPPLE_RIG)) === 'Grapple rig destroyed' && rigs(saved.items) === 0, 'a rig can be destroyed like anything owned');
  const third = browser(saved, { keeper: 'here' });
  await third.eq.load(saved as never);
  ok(rigs(saved.items) === 0, 'and a record marked as given is not given one again: once is once');
  const owned = record('c-had', [shirt(), { id: GRAPPLE_RIG, kind: 'gear', got: 3, thing: 'ggrapple_rig|3|zz' }]);
  const had = browser(owned, { keeper: 'here' });
  await had.eq.load(owned as never);
  ok(rigs(owned.items) === 1 && owned.gear === 1, 'a character that already owns one is marked and given no second');
  const use = await had.eq.use('gear', GRAPPLE_RIG);
  ok(/carried/.test(use.note) && use.wants === null, `using it does nothing but say it is carried (${use.note})`);
  const srv = record('c-server', [shirt()]);
  const kept = browser(srv, { keeper: 'server' });
  await kept.eq.load(srv as never);
  ok(rigs(srv.items) === 0 && srv.gear === undefined, 'where a server keeps gear the record\'s own mark gives nothing: the server\'s list decides');
}

// --- 1b. Not a change the player made, and given by nobody while nobody knows who keeps it ------------------------
{
  // A character this browser has played before, its counter at one, given its rig as it loads: through the session's
  // own `noteRewritten` (as `main.ts` wires `rewritten`) the counter stays where it was, so a copy a server holds one
  // change ahead is still the newer one at the next claim and no tie is put to the player for a rig.
  const grantWith = async (wired: boolean) => {
    const s = new Session(memStore());
    const rec = record(wired ? 'c-count' : 'c-counted', [shirt()]);
    s.noteCharacter(rec as never, ABOUT);
    const b = browser(rec, { keeper: 'here', rewritten: wired ? (was, now) => s.noteRewritten(was as never, now as never) : undefined });
    await b.eq.load(rec as never);
    s.noteCharacter(rec as never, ABOUT);
    return { rec, n: s.counterOf(rec.id) };
  };
  const quiet = await grantWith(true);
  ok(rigs(quiet.rec.items) === 1 && quiet.n === 1, `the rig given at load is adopted without counting a change (counter ${quiet.n})`);
  const counted = await grantWith(false);
  ok(rigs(counted.rec.items) === 1 && counted.n === 2, `(left unsaid, the same grant raises the counter: ${counted.n}, which is what the check above would catch)`);
  // A server saved here and not yet heard from: nothing at load, and given by the record's mark once this browser is
  // known to keep it -- the far end turns out to keep no gear, is the relay that came before, or never answers.
  const s = new Session(memStore());
  const rec = record('c-wait', [shirt()]);
  s.noteCharacter(rec as never, ABOUT);
  let keeper: Keeper = 'pending';
  const b = browser(rec, { keeper: () => keeper, rewritten: (was, now) => s.noteRewritten(was as never, now as never) });
  await b.eq.load(rec as never);
  ok(rigs(rec.items) === 0 && rec.gear === undefined && b.saves.length === 0, 'while a server saved here has not said whether it keeps gear, the load gives nothing and saves nothing');
  ok((await b.eq.grantRigHere()) === false && rigs(rec.items) === 0, 'nor does asking again while it is still not known');
  keeper = 'here';
  ok((await b.eq.grantRigHere()) === true && rigs(rec.items) === 1 && rec.gear === 1, 'once this browser is known to keep it, the rig is given by the record\'s own mark');
  ok(b.saves.length === 1 && rigs((JSON.parse(b.saves[0]) as Rec).items) === 1 && (JSON.parse(b.saves[0]) as Rec).gear === 1, 'in one save, row and mark together');
  ok((await b.eq.grantRigHere()) === false && rigs(rec.items) === 1 && b.saves.length === 1, 'and asked again it gives nothing more and saves nothing');
  s.noteCharacter(rec as never, ABOUT);
  ok(s.counterOf(rec.id) === 1, `nor is it counted as a change (counter ${s.counterOf(rec.id)})`);
  const later = record('c-server-after', [shirt()]);
  let k2: Keeper = 'pending';
  const lb = browser(later, { keeper: () => k2 });
  await lb.eq.load(later as never);
  k2 = 'server';
  ok((await lb.eq.grantRigHere()) === false && rigs(later.items) === 0 && later.gear === undefined, 'and where the server turns out to keep gear the record\'s own mark gives nothing: its list decides');
}

// --- 2. A server that keeps gear: its first list decides ------------------------------------------------------
{
  const sent: Record<string, unknown>[] = [];
  const rec = record('c-new', [shirt()]);
  let eq!: Equipment;
  const trade = tradeFor(() => rec, () => eq, { gear: true, send: (m) => void sent.push(m) });
  eq = browser(rec, { keeper: 'server', keeps: () => true, trade }).eq;
  trade.handle({ t: 'items', do: 'list', take: 'server', rows: [{ id: 'i1', kind: 'wear', what: 'shirt_s03', got: 11, thing: shirt().thing }] });
  await settle();
  await settle();
  const adds = sent.filter((m) => m.t === 'items' && m.do === 'add');
  ok(adds.length === 1 && adds[0].kind === 'gear' && adds[0].what === GRAPPLE_RIG && typeof adds[0].thing === 'string', 'a first settled list with no rig asks the server for one, the way a job\'s reward is given');
  ok(rigs(rec.items) === 1, 'and the rig is in the backpack under the name the ask carried');
  trade.handle({ t: 'items', do: 'list', take: 'server', rows: [{ id: 'i1', kind: 'wear', what: 'shirt_s03', got: 11, thing: shirt().thing }] });
  await settle();
  await settle();
  ok(sent.filter((m) => m.t === 'items' && m.do === 'add').length === 1, 'a later list of the same session that holds none (a trade took it) asks for nothing: the first list decided');
  // A list that holds one asks for nothing.
  const sent2: Record<string, unknown>[] = [];
  const rec2 = record('c-has', [shirt()]);
  let eq2!: Equipment;
  const trade2 = tradeFor(() => rec2, () => eq2, { gear: true, send: (m) => void sent2.push(m) });
  eq2 = browser(rec2, { keeper: 'server', trade: trade2 }).eq;
  trade2.handle({ t: 'items', do: 'list', take: 'server', rows: [{ id: 'i1', kind: 'wear', what: 'shirt_s03', got: 11, thing: shirt().thing }, { id: 'i2', kind: 'gear', what: GRAPPLE_RIG, got: 12, thing: 'srv.i2' }] });
  await settle();
  await settle();
  ok(sent2.filter((m) => m.do === 'add').length === 0 && rigs(rec2.items) === 1, 'a first list that holds one asks for nothing, and the backpack holds the server\'s');
  // Given offline before this character ever met the server, then that server's list: asked for again, not lost.
  const sent3: Record<string, unknown>[] = [];
  const rec3 = record('c-offline', [shirt()]);
  const offline = browser(rec3, { keeper: 'here' });
  await offline.eq.load(rec3 as never);
  ok(rigs(rec3.items) === 1, 'a character played with no server first is given its rig here');
  let eq3!: Equipment;
  const words3: string[] = [];
  const trade3 = tradeFor(() => rec3, () => eq3, { gear: true, send: (m) => void sent3.push(m), words: words3 });
  eq3 = browser(rec3, { keeper: 'server', trade: trade3 }).eq;
  trade3.handle({ t: 'items', do: 'list', take: 'server', rows: [{ id: 'i1', kind: 'wear', what: 'shirt_s03', got: 11, thing: shirt().thing }] });
  await settle();
  await settle();
  ok(sent3.filter((m) => m.do === 'add' && m.kind === 'gear').length === 1 && rigs(rec3.items) === 1, 'a server that already held the character without one takes the offline rig away with its list and is asked for one at once: the rig is asked for again rather than lost');
  ok(words3.length === 1 && !/went/.test(words3[0]), `and the message line is not told a thing went, since the backpack ends holding one as it began (${words3.join(' / ')})`);
  // A later list of the same session that takes it away (a trade, a destroy elsewhere) is said, since nothing gives it back.
  trade3.handle({ t: 'items', do: 'list', take: 'server', rows: [{ id: 'i1', kind: 'wear', what: 'shirt_s03', got: 11, thing: shirt().thing }] });
  await settle();
  await settle();
  ok(words3.length === 2 && /one thing went/.test(words3[1]) && rigs(rec3.items) === 0, `while a later list that takes it away says so, and it stays gone this session (${words3[1]})`);
}

// --- 3. A server whose greeting does not say gear: the rig is never handed up and never taken away -----------------
{
  const sent: Record<string, unknown>[] = [];
  const rec = record('c-oldserver', [shirt()]);
  const offline = browser(rec, { keeper: 'here' });
  await offline.eq.load(rec as never);
  let eq!: Equipment;
  const trade = tradeFor(() => rec, () => eq, { gear: false, send: (m) => void sent.push(m) });
  eq = browser(rec, { keeper: 'here', keeps: (k) => k !== 'gear', trade }).eq;
  trade.tell();
  const list = sent.find((m) => m.do === 'list') as { rows: unknown[][] } | undefined;
  ok(!!list && list.rows.length === 1 && list.rows.every((r) => r[0] !== 'gear'), 'the backpack handed up to it leaves the rig out');
  for (let i = 0; i < 3; i++) {
    trade.handle({ t: 'items', do: 'list', take: i ? 'server' : 'browser', rows: [{ id: 'i1', kind: 'wear', what: 'shirt_s03', got: 11, thing: shirt().thing }] });
    await settle();
  }
  ok(rigs(rec.items) === 1, 'and every list it sends, none of which names a rig, leaves the rig where it is');
  trade.noteAdded({ kind: 'gear', id: GRAPPLE_RIG, got: 1, thing: 'ggrapple_rig|x|1' });
  ok(!sent.some((m) => m.do === 'add'), 'nor is it ever told of one');
  ok(cleanItems({ t: 'items', do: 'add', kind: 'gear', what: GRAPPLE_RIG }) !== undefined, '(a server that keeps gear would have taken it)');
}

// --- 4. A rig traded from one character to another through the real Trade and ledger --------------------------
{
  const world: Record<string, unknown> = emptyWorld(1);
  const ledger = new Ledger({ now: () => Date.now(), tuning: LEDGER_TUNING, write: (rec: Record<string, unknown>) => void applyChange(world, rec), epoch: 1 });
  type Side = { session: number; character: string; rec: Rec; trade: Trade; eq: Equipment };
  const sides = new Map<number, Side>();
  // The few lines of `relay.mjs` that pass items and trades between a browser and the ledger, delivered a task later.
  const deliver = (r: { tell?: { to: number; msg: Record<string, unknown> }[] }) => {
    for (const line of r.tell ?? []) setTimeout(() => sides.get(line.to)?.trade.handle(line.msg), 0);
  };
  const reply = (s: Side, msg: Record<string, unknown>) => setTimeout(() => s.trade.handle(msg), 0);
  const word = (s: Side, msg: Record<string, unknown>) => {
    if (msg.t === 'items') {
      const ask = cleanItems(msg, LEDGER_TUNING) as Record<string, unknown> & { do: string };
      if (!ask) return;
      if (ask.do === 'list' || ask.do === 'get') {
        const settled = ledger.settle(s.character, ask.do === 'list' ? (ask.rows as never) : []);
        deliver(settled);
        reply(s, { t: 'items', do: 'list', take: settled.take, rows: settled.rows });
      } else if (ask.do === 'add') {
        const made = ledger.add(s.character, ask.kind as string, ask.what as string, ask.got as number, { thing: ask.thing as string });
        if (made.ok && (!made.already || made.same)) reply(s, { t: 'items', do: 'added', row: made.row });
      } else if (ask.do === 'using') ledger.using(s.character, ask.worn as string[], ask.held as string[]);
    } else if (msg.t === 'trade') {
      const step = cleanTrade(msg, LEDGER_TUNING) as Record<string, unknown> & { do: string };
      if (!step) return;
      if (step.do === 'ask') deliver(ledger.ask(s.character, [...sides.values()].find((x) => x.session === step.to)!.character, 2));
      else if (step.do === 'accept') deliver(ledger.accept(s.character));
      else if (step.do === 'offer') deliver(ledger.offer(s.character, step.rows as string[]));
      else if (step.do === 'ready') deliver(ledger.ready(s.character, 2));
    }
  };
  const side = (session: number, rec: Rec): Side => {
    const s = { session, character: rec.id, rec } as Side;
    s.trade = tradeFor(() => rec, () => s.eq, { gear: true, send: (m) => word(s, m) });
    s.trade.selfId = () => session;
    s.trade.meAt = (o) => ((o.x = o.y = o.z = 0), true);
    s.trade.peerAt = (_id, o) => ((o.x = 1), (o.y = o.z = 0), true);
    s.eq = browser(rec, { keeper: 'server', trade: s.trade }).eq;
    sides.set(session, s);
    ledger.here(rec.id, { session, name: rec.id });
    return s;
  };
  const ann = side(1, record('c-ann', [{ id: GRAPPLE_RIG, kind: 'gear', got: 5, thing: 'ggrapple_rig|ann|1' }]));
  const ben = side(2, record('c-ben', [{ id: 'pistol_cdef', kind: 'weapon', got: 6, thing: 'wpistol_cdef|ben|1' }]));
  ann.trade.tell();
  ben.trade.tell();
  const wait = async (what: () => boolean) => {
    for (let i = 0; i < 200 && !what(); i++) await settle();
    return what();
  };
  ok(await wait(() => ann.trade.known && ben.trade.known), 'both backpacks are handed up to a ledger that keeps gear');
  ok(await wait(() => rigs(ben.rec.items) === 1), 'Ben, whose first list held no rig, is given one by the server\'s own add');
  ok(rigs(ann.rec.items) === 1 && ledger.countOf('c-ann', 'gear', GRAPPLE_RIG) === 1, 'Ann\'s, handed up with her backpack, is the server\'s row now');
  const annRig = ann.rec.items!.find((o) => o.kind === 'gear')!;
  ok(ann.trade.askTrade(2, 'Ben') === '', 'Ann asks Ben to trade');
  ok(await wait(() => !!ben.trade.asked), 'Ben is asked');
  ben.trade.accept();
  ok(await wait(() => !!ann.trade.window && !!ben.trade.window), 'and the window opens on both sides');
  ok(ann.trade.putIn({ kind: 'gear', id: GRAPPLE_RIG, thing: annRig.thing }) === '', 'a rig goes into a trade like anything owned');
  ok(await wait(() => (ben.trade.window?.theirs.length ?? 0) === 1), 'and Ben sees it in Ann\'s pane');
  ok(ann.trade.setReady(true) === '' && ben.trade.setReady(true) === '', 'both say they are happy');
  ok(await wait(() => rigs(ben.rec.items) === 2 && rigs(ann.rec.items) === 0), `the rig changes hands: Ben holds two, Ann none (Ben ${rigs(ben.rec.items)}, Ann ${rigs(ann.rec.items)})`);
  ok(ben.rec.items!.some((o) => o.thing === annRig.thing), 'Ben holds Ann\'s rig under the name it always had');
  ok(ledger.countOf('c-ben', 'gear', GRAPPLE_RIG) === 2 && ledger.countOf('c-ann', 'gear', GRAPPLE_RIG) === 0, 'and the ledger agrees, row for row');
  await settle();
  ok(rigs(ann.rec.items) === 0, 'Ann\'s list after the trade asks for no rig again this session: her first list decided');
}

console.log(`\n${checks} checks passed`);
