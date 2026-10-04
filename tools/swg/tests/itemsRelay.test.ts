// A row per thing through a real relay: a world written by a server from before things had names read
// back without a row lost or a byte of it rewritten, two of one shirt handed up and coloured apart, the
// coloured one traded with its colour, a reconnect and a second server started from what the first
// wrote down agreeing name for name, a browser built before names unable to make two of anything, a
// takeover in the middle of a trade leaving everything where it was, the worst backpack there is -- four
// hundred copies of the longest id -- handed up by the browser's own ledger inside what a server takes
// from one browser in a second, and a second copy given in play reaching the server by its name.
//
// The rules have tests of their own (ledger.test.ts, tradeBrowser.test.ts). What they cannot see is
// the glue in `server/relay.mjs` and the store under it: the hail that says `items: 2`, a colour word
// reaching its handler, the lazy write, a log played back on start. So the relay itself is run here, on
// a port of its own and a world in a temp folder, with plain sockets standing in for browsers and,
// for the hand-up, the browser's own `Trade`. Every step counts what the server holds: an item may
// never be duplicated and may never be lost.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const note = (msg: string): void => console.log(`     ${msg}`);

type Msg = Record<string, unknown>;
type Row = { id: string; kind: string; what: string; got: number; thing?: string; tint?: Record<string, number> | null; tintAt?: number };

if (typeof WebSocket === 'undefined') {
  note('the relay round trip was skipped: this node has no WebSocket of its own');
} else {
  const { randomBytes } = await import('node:crypto');
  const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
  const { mintThing } = await import('../../../src/core/inventory.ts');
  const { Trade } = await import('../../../src/net/trade.ts');
  const dir = mkdtempSync(join(tmpdir(), 'swg-items-relay-'));
  const port = 18851;

  // ---- a world written by the server that came before ------------------------------------------------
  //
  // One player, one character the server already holds, and that character's rows as a server before
  // things had names wrote them: no names, and two of one shirt -- which that server's own reader kept
  // on the disk and out of memory, so it was the character's all along.
  const keyOld = new Uint8Array(randomBytes(32));
  const pidOld = playerIdFor(keyOld);
  const EPOCH = 1_700_000_000_000;
  const old = {
    v: 1,
    seq: 0,
    epoch: EPOCH,
    players: { [pidOld]: { id: pidOld, key: verifierFor(keyOld), first: 1 } },
    characters: { 'c-old': { id: 'c-old', owner: pidOld, name: 'Old', species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '', counter: 1, items: 1 } },
    items: {
      i1: { id: 'i1', owner: 'c-old', kind: 'wear', what: 'shirt_s03', got: 10 },
      i2: { id: 'i2', owner: 'c-old', kind: 'wear', what: 'shirt_s03', got: 11 },
      i3: { id: 'i3', owner: 'c-old', kind: 'weapon', what: 'pistol_cdef', got: 12 },
    },
    houses: {},
    purses: {},
    stories: {},
    storyArchive: {},
    storyTexts: {},
    settings: {},
  };
  const worldText = JSON.stringify(old);
  writeFileSync(join(dir, 'world.json'), worldText);

  process.env.PORT = String(port);
  // Its world goes in the temp folder and never in `server/data`, which is somebody's real world. A
  // line taken over is left open a moment before it is closed, so the refusal can be read.
  process.argv.push(`--data=${dir}`, '--set=close.grace=300');
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = () => wait(150);
  /** How many things the server holds, by its own status page. */
  const held = async (p = port) => {
    const status = (await (await fetch(`http://127.0.0.1:${p}/`)).json()) as { items: string };
    const n = /^(\d+) things/.exec(status.items);
    return n ? Number(n[1]) : 0;
  };

  type Browser = Awaited<ReturnType<typeof connect>>;
  /** A browser: its key (or one handed in, to be the same player), its character, and everything it heard. */
  async function connect(name: string, character: string, o: { key?: Uint8Array; at?: number; x?: number; v?: number } = {}) {
    const key = o.key ?? new Uint8Array(randomBytes(32));
    const ws = new WebSocket(`ws://127.0.0.1:${o.at ?? port}`);
    const got: Msg[] = [];
    let nonce = '';
    await new Promise<void>((done, fail) => {
      ws.addEventListener('open', () => done());
      ws.addEventListener('error', () => fail(new Error(`${name} could not connect`)));
    });
    const listeners: ((m: Msg) => void)[] = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as Msg;
      if (m.t === 'hail') nonce = String(m.nonce ?? '');
      got.push(m);
      for (const fn of listeners) fn(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    await settle();
    send({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character, name, counter: 1, about: { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' } });
    await settle();
    send({ t: 'hello', name, species: 'human_male', class: 'jedi', planet: 'tatooine', v: o.v ?? 6 });
    await settle();
    send({ t: 'state', p: [o.x ?? 0, 0, 0], h: 0, s: 'idle', v: 0 });
    await settle();
    const welcome = got.find((m) => m.t === 'welcome') as { id?: number } | undefined;
    return {
      key,
      id: Number(welcome?.id ?? 0),
      got,
      send,
      raw: ws,
      listen: (fn: (m: Msg) => void) => void listeners.push(fn),
      close: () => ws.close(),
      isOpen: () => ws.readyState === WebSocket.OPEN,
      last: (t: string, pick: (m: Msg) => boolean = () => true) => [...got].reverse().find((m) => m.t === t && pick(m)),
      /** The last list the server sent, as rows. */
      list: () => ((([...got].reverse().find((m) => m.t === 'items' && m.do === 'list') as Msg | undefined)?.rows ?? []) as Row[]),
    };
  }
  const opened: Browser[] = [];
  const open = async (...args: Parameters<typeof connect>) => {
    const b = await connect(...args);
    opened.push(b);
    return b;
  };
  const key = (rows: Row[]) =>
    rows
      .map((r) => `${r.id}:${r.kind}:${r.what}:${r.thing}:${JSON.stringify(r.tint ?? null)}`)
      .sort()
      .join('|');
  /**
   * The longest catalogue id there is, from the wardrobe and the weapons rack the converter wrote when
   * they are here, else one of the length the longest was measured at over them: 46 characters.
   */
  function longestId(): string {
    const root = join(fileURLToPath(new URL('../../../', import.meta.url)), 'assets-private');
    const found = new Set<string>();
    try {
      for (const folder of ['human_male', 'human_female', 'ithorian_male', 'ithorian_female']) {
        const w = JSON.parse(readFileSync(join(root, 'wardrobe', folder, 'wardrobe.json'), 'utf8')) as { items?: { id?: string }[] };
        for (const it of w.items ?? []) if (typeof it.id === 'string') found.add(it.id);
      }
      const m = JSON.parse(readFileSync(join(root, 'weapons', 'manifest.json'), 'utf8')) as { weapons?: { id?: string }[] };
      for (const it of m.weapons ?? []) if (typeof it.id === 'string') found.add(it.id);
    } catch {
      found.clear();
    }
    if (found.size) {
      const id = [...found].sort((a, b) => b.length - a.length)[0];
      note(`the hand-up is made of the longest id of ${found.size} the converted packs carry (${id.length} characters)`);
      return id;
    }
    note('no converted packs here: the hand-up is made of an id of the length the longest was measured at');
    return 'item_longest_'.padEnd(46, 'x');
  }

  try {
    // ---- 1: the old world read back ------------------------------------------------------------------
    const a0 = await open('Old', 'c-old', { key: keyOld });
    const hail = a0.last('hail') as Msg;
    ok(hail.v === 6 && hail.items === 2, `the relay speaks the sixth wire and its hail says it keeps a row per thing (v ${hail.v}, items ${hail.items})`);
    ok(await held() === 3, 'a world written before things had names is read with every row it holds: the second shirt its own reader hid comes back');
    a0.send({ t: 'items', do: 'get' });
    await settle();
    const oldRows = a0.list();
    const e36 = EPOCH.toString(36);
    ok(oldRows.length === 3 && oldRows.filter((r) => r.what === 'shirt_s03').length === 2, 'and the character is handed both shirts');
    ok(oldRows.every((r) => r.thing === `${e36}.${r.id}`), `each named on read by the world's birth and its own row (${oldRows.map((r) => r.thing).join(', ')})`);
    const disk = readFileSync(join(dir, 'world.json'), 'utf8');
    const log = readFileSync(join(dir, 'world.log'), 'utf8');
    ok(disk === worldText && !/"t":"item/.test(log), 'and nothing about them was written: the file stands as the old server left it and the log holds no item line');
    a0.close();
    await settle();

    // ---- 2: two of one shirt handed up, one coloured; a pistol on the other side ----------------------
    const keyA = new Uint8Array(randomBytes(32));
    const a = await open('Han', 'c-a', { key: keyA, x: 0 });
    const b = await open('Chewie', 'c-b', { x: 3 });
    const now = Date.now();
    const shirt1 = mintThing('wear', 'shirt_s03', now);
    const shirt2 = mintThing('wear', 'shirt_s03', now + 1);
    const pistol = mintThing('weapon', 'pistol_cdef', now);
    a.send({ t: 'items', do: 'list', rows: [{ kind: 'wear', what: 'shirt_s03', got: now, thing: shirt1, tint: { index_color_1: 5 }, tintAt: now }, { kind: 'wear', what: 'shirt_s03', got: now + 1, thing: shirt2 }] });
    b.send({ t: 'items', do: 'list', rows: [{ kind: 'weapon', what: 'pistol_cdef', got: now, thing: pistol }] });
    await settle();
    const aRows = a.list();
    ok(aRows.length === 2 && aRows.map((r) => r.thing).sort().join() === [shirt1, shirt2].sort().join(), 'two of one shirt handed up are two rows, each under the name its browser gave it');
    ok(aRows.find((r) => r.thing === shirt1)?.tint?.index_color_1 === 5 && aRows.find((r) => r.thing === shirt2)?.tint === undefined, 'and the coloured one keeps its colour while the other has none');
    ok(b.list().length === 1 && b.list()[0].thing === pistol, 'the other side holds its pistol');
    const total = await held();
    ok(total === 6, `the server holds six things (${total})`);

    // ---- 3: the other shirt coloured; the other side sees it on offer -----------------------------------
    const row2 = aRows.find((r) => r.thing === shirt2)!.id;
    a.send({ t: 'items', do: 'tint', id: row2, tint: { index_color_1: 9 }, at: Date.now() });
    await settle();
    ok(!a.last('items', (m) => m.do === 'refused'), 'its owner colours the other shirt, and nothing is refused');
    b.send({ t: 'items', do: 'tint', id: row2, tint: { index_color_1: 1 } });
    await settle();
    ok(!!b.last('items', (m) => m.do === 'refused'), 'while somebody else may not');
    a.send({ t: 'trade', do: 'ask', to: b.id });
    await settle();
    b.send({ t: 'trade', do: 'accept' });
    await settle();
    a.send({ t: 'trade', do: 'offer', rows: [row2] });
    await settle();
    const seen = b.last('trade', (m) => m.do === 'state') as { theirs: { rows: Row[] } } | undefined;
    ok(seen?.theirs.rows.length === 1 && seen.theirs.rows[0].thing === shirt2 && seen.theirs.rows[0].tint?.index_color_1 === 9, 'the other side sees the shirt on offer, by its name, in the colour it was given');
    a.send({ t: 'items', do: 'tint', id: row2, tint: { index_color_1: 2 }, at: Date.now() });
    await settle();
    ok(/trade/.test(String((a.last('items', (m) => m.do === 'refused') as Msg | undefined)?.why ?? '')), 'and it cannot be coloured again while it is up: they get what they were shown');

    // ---- 4: the coloured shirt traded ---------------------------------------------------------------
    a.send({ t: 'trade', do: 'ready' });
    await settle();
    b.send({ t: 'trade', do: 'ready' });
    await settle();
    ok(!!a.last('trade', (m) => m.do === 'done') && !!b.last('trade', (m) => m.do === 'done'), 'both say they are happy and the trade is done');
    ok(await held() === total, 'the server holds exactly as many things as before the trade');
    a.send({ t: 'items', do: 'get' });
    b.send({ t: 'items', do: 'get' });
    await settle();
    ok(a.list().length === 1 && a.list()[0].thing === shirt1, 'the giver has the first shirt left');
    const arrived = b.list().find((r) => r.thing === shirt2);
    ok(b.list().length === 2 && arrived?.tint?.index_color_1 === 9, 'and the taker has the second, its name and its colour arriving with it');

    // ---- 5: a reconnect, and the totals --------------------------------------------------------------
    const bBefore = key(b.list());
    const keyB = b.key;
    b.close();
    await settle();
    const b2 = await open('Chewie', 'c-b', { key: keyB, x: 3 });
    b2.send({ t: 'items', do: 'list', rows: [], known: 1, rev: 1 });
    await settle();
    ok(key(b2.list()) === bBefore, 'a browser that comes back is handed the very same rows, names and colours and all');
    ok(await held() === total, 'and the server still holds the same number of things');

    // ---- 6: a browser built before things had names --------------------------------------------------
    const d = await open('Lando', 'c-d', { x: 5 });
    d.send({ t: 'items', do: 'list', rows: [{ kind: 'wear', what: 'shirt_s03', got: 1 }, { kind: 'wear', what: 'shirt_s03', got: 2 }] });
    await settle();
    ok(d.list().length === 1, 'a list from a browser that names nothing is folded by kind and id: it cannot hand up two of anything');
    d.send({ t: 'items', do: 'add', kind: 'wear', what: 'shirt_s03', got: 3 });
    await settle();
    ok(!d.last('items', (m) => m.do === 'added') && await held() === total + 1, 'and its add of something it already has makes nothing new');
    const added = total + 1;

    // ---- 7: a takeover in the middle of a trade -------------------------------------------------------
    a.send({ t: 'trade', do: 'ask', to: b2.id });
    await settle();
    b2.send({ t: 'trade', do: 'accept' });
    await settle();
    a.send({ t: 'trade', do: 'offer', rows: [a.list()[0].id] });
    await settle();
    const aBefore = key(a.list());
    const a2 = await open('Han', 'c-a', { key: keyA, x: 0 });
    await settle();
    ok(!!b2.last('trade', (m) => m.do === 'off'), 'the same character opened in another browser breaks the trade off');
    a2.send({ t: 'items', do: 'list', rows: [], known: 1, rev: 1 });
    await settle();
    ok(key(a2.list()) === aBefore && await held() === added, 'and every item is where it was: nothing moved, nothing made, nothing lost');

    // ---- 8: a full backpack, by the browser's own ledger ---------------------------------------------
    const c = await open('Mon', 'c-full', { x: 7 });
    await wait(1100);
    const t = new Trade();
    t.authority = () => 'server';
    t.itemsVersion = () => 2;
    let bytes = 0;
    t.send = (msg) => {
      const text = JSON.stringify(msg);
      bytes = Math.max(bytes, Buffer.byteLength(text));
      c.raw.send(text);
    };
    c.listen((m) => void t.handle(m));
    // The worst backpack a browser can hand up. Two of one item are two things now, so the largest is not
    // four hundred different ids but four hundred copies of the longest there is, under the longer of the
    // two kind words, every one with a name (which carries the id again) and none with a colour.
    const longest = longestId();
    const mine = Array.from({ length: 400 }, (_, i) => {
      const got = Date.now() + i;
      return { kind: 'weapon' as const, id: longest, got, thing: mintThing('weapon', longest, got) };
    });
    t.mine = () => mine;
    t.tell();
    await wait(600);
    const asObjects = Buffer.byteLength(JSON.stringify({ t: 'items', do: 'list', rows: mine.map((o) => ({ kind: o.kind, what: o.id, got: o.got, thing: o.thing })) }));
    note(`written out as objects the same backpack would be ${asObjects} bytes`);
    ok(bytes < 65536, `four hundred copies of the longest id handed up with every name and no colour are ${bytes} bytes, inside the ${65536} a server takes from one browser in a second, so not a word of that second's news is trimmed`);
    ok(c.isOpen() && t.list.length === 400 && t.known, `and the server takes it whole and hands it back (${t.list.length} rows)`);
    ok(new Set(t.list.map((r) => r.thing)).size === 400 && t.list.every((r) => !!r.thing && !!r.row && r.id === longest) && t.list.some((r) => r.thing === mine[0].thing), 'four hundred things of one item, each under its own name and its own row id');
    ok(await held() === added + 400, 'and the server holds four hundred more');

    // ---- 8b: a second copy given in play, by name, through the relay and the browser's own ledger ----
    //
    // The one way a second of something is made after the hand-up: the give tab's another, which the
    // browser tells the server as a named `add`. Dropped at either end, the server would keep one shirt
    // while the backpack kept two, and the next list would take the second away again.
    const e = await open('Wedge', 'c-add', { x: 9 });
    await wait(1100);
    const te = new Trade();
    te.authority = () => 'server';
    te.itemsVersion = () => 2;
    const adds: Msg[] = [];
    te.send = (msg) => {
      if (msg.do === 'add') adds.push(msg);
      e.raw.send(JSON.stringify(msg));
    };
    e.listen((m) => void te.handle(m));
    const g0 = Date.now();
    const shirtA = { kind: 'wear' as const, id: 'shirt_s03', got: g0, thing: mintThing('wear', 'shirt_s03', g0) };
    te.mine = () => [shirtA];
    te.tell();
    await settle();
    const beforeAdd = await held();
    ok(te.list.length === 1 && beforeAdd === added + 401, 'a character hands up one shirt');
    const thingB = mintThing('wear', 'shirt_s03', g0 + 1);
    const addB = { t: 'items', do: 'add', kind: 'wear', what: 'shirt_s03', got: g0 + 1, thing: thingB };
    e.send(addB);
    await settle();
    const answer = e.last('items', (m) => m.do === 'added') as { row?: Row } | undefined;
    ok(answer?.row?.thing === thingB && answer.row.what === 'shirt_s03' && !!answer.row.id, 'a named add of a second shirt is answered with a row of its own under that name');
    ok(await held() === beforeAdd + 1, 'and the server holds one thing more');
    const answers = e.got.filter((m) => m.t === 'items' && m.do === 'added').length;
    e.send(addB);
    await settle();
    ok(e.got.filter((m) => m.t === 'items' && m.do === 'added').length === answers + 1 && await held() === beforeAdd + 1, 'said again, it is answered again -- the first answer may be what was lost -- and nothing more is made');
    const shirtC = { kind: 'wear' as const, id: 'shirt_s03', got: g0 + 2, thing: mintThing('wear', 'shirt_s03', g0 + 2) };
    te.noteAdded(shirtC);
    await settle();
    ok(adds.length === 1 && adds[0].thing === shirtC.thing, 'the browser\'s own ledger names the thing in the add it sends');
    ok(te.rowOf(shirtC) !== '' && te.list.filter((r) => r.id === 'shirt_s03').length === 3 && await held() === beforeAdd + 2, 'and the server keeps it as a third shirt, which the browser then knows by its row');
    e.send({ t: 'items', do: 'get' });
    await settle();
    ok(e.list().filter((r) => r.what === 'shirt_s03').map((r) => r.thing).sort().join() === [shirtA.thing, thingB, shirtC.thing].sort().join(), 'the list the server hands back holds three shirts under their three names');

    // ---- 8c: a browser built before things had names is never traded a second of something it has -----
    //
    // It folds its list by kind and id and keeps one, so a second shirt handed to it would be held by the
    // server and never seen by its player. Its hello says the fifth wire, which is what the relay goes by.
    const giver = await open('Dodonna', 'c-give', { x: 40 });
    const wes = await open('Wes', 'c-wes', { x: 42, v: 5 });
    const hobbie = await open('Hobbie', 'c-hob', { x: 44 });
    const g1 = Date.now();
    giver.send({ t: 'items', do: 'list', rows: [{ kind: 'wear', what: 'shirt_s03', got: g1, thing: mintThing('wear', 'shirt_s03', g1) }, { kind: 'wear', what: 'shirt_s03', got: g1 + 1, thing: mintThing('wear', 'shirt_s03', g1 + 1) }] });
    wes.send({ t: 'items', do: 'list', rows: [{ kind: 'wear', what: 'shirt_s03', got: g1 }] });
    hobbie.send({ t: 'items', do: 'list', rows: [{ kind: 'wear', what: 'shirt_s03', got: g1, thing: mintThing('wear', 'shirt_s03', g1) }] });
    await settle();
    const before8c = await held();
    const [giveA, giveB] = giver.list().map((r) => r.id);
    const tradeTo = async (to: Browser, row: string) => {
      giver.send({ t: 'trade', do: 'ask', to: to.id });
      await settle();
      to.send({ t: 'trade', do: 'accept' });
      await settle();
      giver.send({ t: 'trade', do: 'offer', rows: [row] });
      await settle();
      giver.send({ t: 'trade', do: 'ready' });
      await settle();
      to.send({ t: 'trade', do: 'ready' });
      await settle();
    };
    await tradeTo(wes, giveA);
    const off = wes.last('trade', (m) => m.do === 'off' || m.do === 'done') as Msg | undefined;
    ok(off?.do === 'off' && /already has one of those/.test(String(off.why)), `a second shirt for a browser that keeps one of each is refused whole, in the old words (${off?.do}: ${off?.why})`);
    wes.send({ t: 'items', do: 'get' });
    giver.send({ t: 'items', do: 'get' });
    await settle();
    ok(wes.list().length === 1 && giver.list().length === 2 && await held() === before8c, 'and nothing moved: it holds its one shirt, the giver both of theirs, the server as many things as before');
    await tradeTo(hobbie, giveB);
    ok(hobbie.last('trade', (m) => m.do === 'off' || m.do === 'done')?.do === 'done', 'while a browser that names its things is handed the second shirt');
    hobbie.send({ t: 'items', do: 'get' });
    await settle();
    ok(hobbie.list().filter((r) => r.what === 'shirt_s03').length === 2 && await held() === before8c, 'and holds two, with nothing made or lost');

    // ---- 8d: a line a newer browser has just taken over says nothing more for that character ---------
    //
    // The older line is told and closed a moment later; whatever it sends in that moment would land on the
    // backpack the newer browser now holds. It sends everything a stale tab could, the instant it is told.
    const biggs = await open('Biggs', 'c-take', { x: 50 });
    const porkins = await open('Porkins', 'c-near', { x: 52 });
    const t0 = Date.now();
    biggs.send({ t: 'items', do: 'list', rows: [{ kind: 'wear', what: 'shirt_s03', got: t0, thing: mintThing('wear', 'shirt_s03', t0) }, { kind: 'wear', what: 'hat_s04', got: t0 + 1, thing: mintThing('wear', 'hat_s04', t0 + 1) }] });
    porkins.send({ t: 'items', do: 'list', rows: [{ kind: 'weapon', what: 'pistol_cdef', got: t0, thing: mintThing('weapon', 'pistol_cdef', t0) }] });
    await wait(1100);
    const biggsRows = biggs.list();
    const biggsBefore = key(biggsRows);
    const before8d = await held();
    const askedBefore = porkins.got.filter((m) => m.t === 'trade' && m.do === 'asked').length;
    let heardFrom = -1;
    biggs.listen((m) => {
      if (m.t !== 'taken') return;
      heardFrom = biggs.got.length;
      biggs.send({ t: 'items', do: 'drop', id: biggsRows[0].id });
      biggs.send({ t: 'items', do: 'add', kind: 'wear', what: 'boots_s03', got: Date.now(), thing: mintThing('wear', 'boots_s03', Date.now()) });
      biggs.send({ t: 'items', do: 'tint', id: biggsRows[1].id, tint: { index_color_1: 7 }, at: Date.now() });
      biggs.send({ t: 'trade', do: 'ask', to: porkins.id });
      biggs.send({ t: 'items', do: 'get' });
    });
    const biggs2 = await open('Biggs', 'c-take', { key: biggs.key, x: 50 });
    biggs2.send({ t: 'items', do: 'get' });
    await settle();
    ok(heardFrom >= 0, 'the older line is told it has been taken over, and speaks in the moment before it is closed');
    ok(key(biggs2.list()) === biggsBefore && await held() === before8d, 'and nothing it says lands: nothing dropped, nothing added, no colour put on, the server holding as many things as before');
    ok(porkins.got.filter((m) => m.t === 'trade' && m.do === 'asked').length === askedBefore, 'nobody is asked to trade by it');
    ok(!biggs.got.slice(heardFrom).some((m) => m.t === 'items'), 'and it is answered nothing about the backpack it no longer holds');

    // ---- 9: a server started again from what this one wrote down -----------------------------------
    const live = { a: key(a2.list()), b: key(b2.list()), old: key(oldRows), e: key(e.list()) };
    const finalHeld = await held();
    const copy = mkdtempSync(join(tmpdir(), 'swg-items-restart-'));
    for (const f of readdirSync(dir)) copyFileSync(join(dir, f), join(copy, f));
    const port2 = port + 1;
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../server/relay.mjs', import.meta.url)), `--data=${copy}`, `--port=${port2}`], { stdio: 'ignore' });
    try {
      let back: { a: Browser; b: Browser; old: Browser; e: Browser } | null = null;
      for (let tries = 0; tries < 40 && !back; tries++) {
        await wait(150);
        try {
          back = {
            a: await connect('Han', 'c-a', { key: keyA, at: port2 }),
            b: await connect('Chewie', 'c-b', { key: keyB, at: port2 }),
            old: await connect('Old', 'c-old', { key: keyOld, at: port2 }),
            e: await connect('Wedge', 'c-add', { key: e.key, at: port2 }),
          };
        } catch {
          back = null;
        }
      }
      ok(!!back, 'a relay started again on a copy of what this one wrote down takes the same players and characters');
      for (const k of ['a', 'b', 'old', 'e'] as const) back![k].send({ t: 'items', do: 'get' });
      await settle();
      ok(key(back!.a.list()) === live.a && key(back!.b.list()) === live.b, 'and hands down the very same rows, names and colours included, the traded shirt still in its colour');
      ok(key(back!.old.list()) === live.old, 'the old world\'s rows under the same names it worked out on read the first time');
      ok(key(back!.e.list()) === live.e, 'and the shirts given in play by name, every one of them, under the same names');
      ok(await held(port2) === finalHeld, `and holds exactly as many things (${finalHeld})`);
      for (const k of ['a', 'b', 'old', 'e'] as const) back![k].close();
    } finally {
      child.kill();
      setTimeout(() => {
        try {
          rmSync(copy, { recursive: true, force: true });
        } catch {
          /* a temp folder either way */
        }
      }, 300);
    }
    for (const o of opened) o.close();
    await settle();
  } finally {
    // The relay owns the port and the store for the rest of this process; the folder is ours.
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the server still has it open: a temp folder either way */
      }
      console.log(`\n${passed} checks passed`);
      process.exit(0);
    }, 200);
  }
}
