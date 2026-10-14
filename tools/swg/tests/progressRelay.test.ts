// A character's progress through a real relay, with the browser's own stack -- `Net`, `Session`, the story's
// `BookClient`, the ledger's `Trade` and `ProgressClient` -- wired as `src/main.ts` wires them, so every progress
// word goes through `src/net/net.ts`'s own switch and nothing is handed to anybody by hand:
//
//   - the hail says the server holds progress, and a browser built before this reads the hail and the welcome as it
//     always did, the welcome once;
//   - a character played alone, with XP and a node, connects and its record is carried up whole (`take: 'browser'`),
//     with nothing left counted as made alone and the character's mark adopted without its counter moving, and the
//     relay says nothing of a browser sending too fast;
//   - a fight claimed is paid through the server's batch, and the browser applies nothing of it first; the batch's
//     revision is the one the status page says;
//   - a node learnt is answered with the server's batch;
//   - a quest whose reward carries experience, run by the server's own story host (`--story-tests`), pays its bonus
//     once, into the skill the fight during it used;
//   - a body this browser keeps, claimed dead ahead of its own death word, is parked by the server and paid in full
//     when the relay hears that word on the very world the line stands on, and one whose death never comes is
//     refused when the relay's tick runs its park out (`--set progress.claimPark`);
//   - a far end whose hail says nothing of progress leaves it to this browser, which sends it no word of it;
//   - and the worst hand-up there is on one claim -- four hundred copies of the longest id in the backpack, a story
//     book of several pieces and a progress record at every cap -- leaves the line open and every piece taken.
//
// The relay is run here, on a port of its own (18891, which no other test holds) with a world in a temp folder and no
// converted content (`--assets` names an empty folder), so every fight is banded by the fallback of ours and nothing
// of the game's own table is read or said. Every number is a TEST number.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const note = (msg: string): void => console.log(`     ${msg}`);

type Msg = Record<string, unknown>;

/** Whether a port is free, so the relay this test starts never lands on somebody else's. */
const free = (port: number) =>
  new Promise<boolean>((done) => {
    const s = createServer();
    s.once('error', () => done(false));
    s.listen(port, '127.0.0.1', () => s.close(() => done(true)));
  });

if (typeof WebSocket === 'undefined') {
  note('the relay round trip was skipped: this node has no WebSocket of its own');
} else {
  const port = 18891;
  if (!(await free(port))) throw new Error(`port ${port} is held by something else: this test starts a relay of its own there`);
  const dir = mkdtempSync(join(tmpdir(), 'swg-progress-relay-'));
  // What the relay says on its own console, kept: whether it ever says a browser sent too fast is a check.
  const relayLog: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    if (!line.startsWith('ok   ') && !line.startsWith('     ')) relayLog.push(line);
    else log(...args);
  };
  process.env.PORT = String(port);
  // A claim parked for a death word waits a second here rather than three, through the relay's own `--set`.
  process.argv.push(`--data=${dir}`, `--assets=${join(dir, 'no-assets')}`, '--story-tests', '--set=settle.wait=2500', '--set=close.grace=300', '--set=progress.claimPark=1000');
  await import('../../../server/relay.mjs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: () => boolean, ms = 6000) => {
    for (let t = 0; t < ms && !what(); t += 50) await wait(50);
    return what();
  };
  const status = async () => (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { connected: number; items: string; progress: { records: number; parked: number; playing: { char: string; rev: number }[]; last: { character: string; rev: number; kind: string } | null; stats: Record<string, number> }; progressTuning: { claimPark: number } };
  /** Until the status page says something, polled. */
  const untilStatus = async (what: (s: Awaited<ReturnType<typeof status>>) => boolean, ms = 6000) => {
    for (let t = 0; t < ms; t += 100) {
      if (what(await status())) return true;
      await wait(100);
    }
    return what(await status());
  };
  const held = async () => Number(/^(\d+) things/.exec((await status()).items)?.[1] ?? 0);

  // The browser's own stack, with a window and a storage of the test's.
  const shelf = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, String(v)), removeItem: (k: string) => void shelf.delete(k) };
  g.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  const { Net } = await import('../../../src/net/net.ts');
  const { BookClient } = await import('../../../src/story/bookClient.ts');
  const { browserStoryStorage } = await import('../../../src/story/storyStore.ts');
  const { emptyBook } = await import('../../../src/story/book.ts');
  const { ProgressClient } = await import('../../../src/progress/progressClient.ts');
  const { Trade } = await import('../../../src/net/trade.ts');
  const { mintThing } = await import('../../../src/core/inventory.ts');
  const { emptyRecord, applyProgress, recordText } = await import('../../../src/progress/record.ts');
  const { grantChanges } = await import('../../../src/progress/learn.ts');
  const { xpCap } = await import('../../../src/progress/core.ts');
  const { PROGRESS_LIMITS, PROGRESS_RULES, PROGRESS_TUNE } = await import('../../../src/progress/tune.ts');

  const net = new Net();
  const said: string[] = [];
  const sent: { at: number; bytes: number; what: string }[] = [];
  /** Every word this browser hands the socket, measured as it goes. */
  const say = (m: Msg) => {
    sent.push({ at: Date.now(), bytes: Buffer.byteLength(JSON.stringify(m)), what: `${m.t}:${String(m.do ?? '')}` });
    net.sendWord(m);
  };
  const story = new BookClient({ store: browserStoryStorage(), send: say, say: (t) => void said.push(t), now: () => Date.now(), wall: () => Date.now(), line: () => ({ authority: net.session.authority, story: net.session.storyVersion, status: net.status, mode: net.session.mode }), known: () => false });
  const progress = new ProgressClient({ store: browserStoryStorage(), now: () => Date.now(), say: (t) => void said.push(t), send: say, line: () => ({ authority: net.session.authority, progress: net.session.progressVersion, status: net.status, mode: net.session.mode }), wall: () => Date.now(), known: () => false });
  const trade = new Trade();
  trade.authority = () => net.session.authority;
  trade.itemsVersion = () => net.session.itemsVersion;
  trade.send = say;
  let backpack: { kind: 'wear' | 'weapon'; id: string; got: number; thing: string }[] | null = null;
  trade.mine = () => backpack;
  // The character in play, as the game hands it to the session.
  let record = { id: 'c-net', name: 'Wedge' };
  const about = { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' };
  const marked = () => ({ ...record, story: { local: story.local }, progress: { local: progress.localOf(record.id) } });
  // Wired as the game wires it: the purse's, the book's, progress's and the ledger's listeners on the claim, in that order.
  net.session.onClaimed(() => story.claimed(!!net.session.ask));
  net.session.onClaimed(() => progress.claimed(!!net.session.ask));
  net.session.onClaimed(() => trade.tell());
  net.session.onAnswered(() => story.answered());
  net.session.onAnswered(() => progress.answered());
  /** The world's creatures this browser has been told to keep, as the server hands them out. */
  const keeps = new Set<string>();
  net.onWord = (m) => {
    if (m.t === 'story') story.word(m);
    if (m.t === 'progress') progress.word(m);
    if (m.t === 'items' || m.t === 'trade') trade.handle(m);
    if (m.t === 'keep') {
      for (const id of (m.add as string[] | undefined) ?? []) keeps.add(id);
      for (const id of (m.drop as string[] | undefined) ?? []) keeps.delete(id);
    }
  };
  story.onChange((why, was) => {
    if (why === 'settled') net.session.noteSettled({ ...marked(), story: { local: was } }, marked());
    else net.session.noteCharacter(marked());
  });
  progress.onChange((why, was) => {
    if (why === 'settled') net.session.noteSettled({ ...marked(), progress: { local: was } }, marked());
    else net.session.noteCharacter(marked());
  });
  const answers: [string, Record<string, number>, string | undefined][] = [];
  progress.onAnswer((id, paid, why) => void answers.push([id, paid, why]));
  const stepper = setInterval(() => {
    story.step(Date.now());
    progress.step(Date.now());
  }, 100);
  const go = () => net.connect(`ws://127.0.0.1:${port}`, { name: record.name, species: 'human_male', class: 'jedi', planet: about.planet });
  let claims = 0;
  const claimOf = (members: { npc: string; w?: string }[]) => ({ id: `erelay${(claims++).toString(36)}`, at: Date.now(), outcome: 'won' as const, used: ['marksmanship' as const], heavy: false, planet: 'tatooine', diff: 1, members: members.map((m) => ({ ...m, level: 1, dead: true, fought: true, share: 0 })) });

  try {
    // ---- a character played alone, carried up on first contact --------------------------------------------------
    story.use('c-net');
    progress.use('c-net');
    net.session.noteCharacter(marked(), about);
    progress.debug({ xp: { demolitions: 4000, melee: 700 } });
    progress.debug({ grant: 'demo.ordnance.1' });
    ok(progress.host === 'local' && progress.local === 2 && !!progress.record!.nodes['demo.ordnance.1'], 'with no server the browser holds the record: XP and a node made alone, two batches');
    const counterAlone = net.session.counterOf('c-net');
    const relayLines = relayLog.length;
    go();
    ok(await until(() => progress.host === 'server' && progress.local === 0), `connected, the record is settled and held by the server (${JSON.stringify((progress.report() as { line: unknown }).line)})`);
    const hail = net.session.debug();
    ok(hail.progress === 1 && net.session.progressVersion === 1, 'the hail said the server holds progress');
    ok(progress.stats.taken === 1 && progress.record!.core.melee === 700 && progress.record!.pools.demolitions === 4000 && !!progress.record!.nodes['demo.ordnance.1'] && progress.record!.base === progress.record!.rev, 'what was made alone went up whole and came back as the server\'s (take: browser), matched to its revision');
    ok(net.session.counterOf('c-net') === counterAlone, `and the settle, which took the count made alone back to nought, adopted the new mark without moving the character's counter (${counterAlone})`);
    const s0 = await status();
    ok(s0.progress.records >= 1 && s0.progress.playing.some((p) => p.char === 'c-net' && p.rev === progress.record!.rev), `the status page lists the record in play at the browser's own revision (${progress.record!.rev})`);
    ok(!relayLog.slice(relayLines).some((l) => /faster than it may|far more than it should/.test(l)), 'and the relay said nothing of a browser sending too fast');

    // ---- a claim paid through the server's batch --------------------------------------------------------------------
    const marks = progress.record!.core.marksmanship ?? 0;
    const rev = progress.record!.rev;
    const fight = claimOf([{ npc: 'test_relay_kreetle' }]);
    const o = progress.claim(fight);
    ok(o.ok && o.sent === true && (progress.record!.core.marksmanship ?? 0) === marks && progress.record!.rev === rev, 'a fight claimed goes to the server, and the browser applies nothing of it first');
    ok(await until(() => (progress.record!.core.marksmanship ?? 0) > marks), 'the server\'s batch comes back through the socket\'s own switch and pays it');
    const s1 = await status();
    ok(progress.record!.rev === rev + 1 && s1.progress.last?.character === 'c-net' && s1.progress.last.rev === progress.record!.rev && s1.progress.last.kind === 'claim', `at the next revision, the one the status page says the server wrote (rev ${s1.progress.last?.rev})`);
    ok(answers.some(([id, paid]) => id === fight.id && (paid.marksmanship ?? 0) > 0) && said.some((l) => /^Marksmanship \+\d+/.test(l)), 'and what it paid is told to whoever asked, and said on the message line in our words');

    // ---- a node learnt -------------------------------------------------------------------------------------------
    // The Novice came with the grant made alone (a grant brings what a node needs above it): Steady Arm is next.
    const learnt = progress.learn('demo.grenadier.1', 'trainer_commando');
    ok(learnt.ok && learnt.sent === true, 'a node asked for from a commando trainer goes to the server');
    ok(await until(() => !!progress.record!.nodes['demo.grenadier.1'] && (progress.record!.pools.demolitions ?? 0) === 1500) && said.includes('Learnt Steady Arm'), 'and is answered with the server\'s batch: owned, its XP taken, said');

    // ---- a quest's bonus, from the server's own story host ------------------------------------------------------------
    ok(await until(() => story.host === 'server'), 'the story book is settled beside it');
    const at = { p: [0, 0] };
    say({ t: 'story', do: 'admin', op: 'grant', quest: 'test:goto', at });
    await wait(1100);
    const during = claimOf([{ npc: 'test_relay_during' }]);
    progress.claim(during);
    ok(await until(() => answers.some(([id]) => id === during.id)), 'a fight while the quest runs is paid');
    const beforeBonus = progress.record!.core.marksmanship ?? 0;
    const bonusesBefore = progress.record!.bonus?.length ?? 0;
    await wait(1100);
    say({ t: 'story', do: 'admin', op: 'complete', quest: 'test:goto', step: 'outdoor', at });
    await wait(300);
    say({ t: 'story', do: 'admin', op: 'complete', quest: 'test:goto', step: 'cantina', at });
    ok(await until(() => (progress.record!.bonus?.length ?? 0) === bonusesBefore + 1), 'the quest done by the server\'s own story host pays its experience as a bonus');
    ok((progress.record!.core.marksmanship ?? 0) === beforeBonus + 5 && said.includes('Quest bonus: Marksmanship +5'), 'into the skill the fight during it used, said as a quest bonus');
    await wait(1100);
    say({ t: 'story', do: 'admin', op: 'complete', quest: 'test:goto', step: 'cantina', at });
    await wait(600);
    ok((progress.record!.bonus?.length ?? 0) === bonusesBefore + 1 && (progress.record!.core.marksmanship ?? 0) === beforeBonus + 5, 'and once');

    // ---- a shared body's death, through the relay's own witness -----------------------------------------------------------
    // This browser stands two of the world's creatures and keeps them; its claim naming one dead goes up before its own
    // word of that death (the two leave a keeper by two paths nothing orders), and the relay's death word, its world's
    // key and its tick are what pay it, or refuse it.
    {
      const { OWN_TUNING } = await import('../../../server/ownership.mjs');
      const { payClaim, XpBuckets } = await import('../../../src/progress/payout.ts');
      const { copyRecord } = await import('../../../src/progress/record.ts');
      net.sendState({ p: [0, 0, 0], h: 0, s: 'idle', v: 0 } as never);
      await wait(150);
      say({ t: 'spawn', do: 'seen', id: 'wild:tatooine:3:0', at: [0, 0, 0], r: 30 });
      say({ t: 'spawn', do: 'seen', id: 'wild:tatooine:3:1', at: [0, 0, 0], r: 30 });
      ok(await until(() => keeps.has('wild:tatooine:3:0') && keeps.has('wild:tatooine:3:1'), OWN_TUNING.grant * 6 + 2000), 'this browser, alone with bodies for two of the world\'s creatures, keeps them both');
      const was = (await status()).progress.stats;
      const early = claimOf([{ npc: 'test_relay_shared', w: 'wild:tatooine:3:0' }]);
      const full = payClaim(copyRecord(progress.record!), early, { now: Date.now(), levels: null, rules: PROGRESS_RULES, limits: PROGRESS_LIMITS, bucket: new XpBuckets(), witness: () => true }).paid.marksmanship ?? 0;
      const marksEarly = progress.record!.core.marksmanship ?? 0;
      await wait(PROGRESS_TUNE.claimGap);
      progress.claim(early);
      ok(await untilStatus((s) => s.progress.parked === 1 && s.progress.stats.parked === was.parked + 1), 'its claim naming one of them dead, ahead of the death word, is parked by the server');
      say({ t: 'spawn', do: 'dead', id: 'wild:tatooine:3:0' });
      ok(await until(() => answers.some(([id, paid, why]) => id === early.id && (paid.marksmanship ?? 0) > 0 && !why)), 'and the keeper\'s word of the death, through the relay, runs it');
      ok((progress.record!.core.marksmanship ?? 0) === marksEarly + full && full > 0, `paid in full, on the very world the relay heard it die on (+${full})`);
      ok(await untilStatus((s) => s.progress.stats.parkedPaid === was.parkedPaid + 1 && s.progress.parked === 0), 'the status page counts it among the parked claims a death word paid');
      const never = claimOf([{ npc: 'test_relay_never', w: 'wild:tatooine:3:1' }]);
      await wait(PROGRESS_TUNE.claimGap);
      progress.claim(never);
      ok(await until(() => answers.some(([id, , why]) => id === never.id && /nothing it fought died/.test(String(why))), 4000), `a claim naming the other dead, whose death the relay never hears, is refused once its park of ${(await status()).progressTuning.claimPark} ms runs out: only the relay's tick can say so`);
      ok(await untilStatus((s) => s.progress.stats.parkedLate === was.parkedLate + 1), 'and the status page counts it among the parks that ran out');
      say({ t: 'spawn', do: 'unseen', id: 'wild:tatooine:3:1' });
    }

    // ---- the line put down: the record is this browser's again ----------------------------------------------------------
    net.disconnect();
    ok(await until(() => progress.host === 'local'), 'the line put down hands the record back to this browser');

    // ---- a far end whose hail says nothing of progress: this browser holds it, exactly as before this wave -----------------
    // The relay that came before never says `progress`; here the real relay's hail has the field taken out on the way
    // in, before `Net` reads it, which is the same thing to the browser.
    {
      const Real = globalThis.WebSocket;
      const strip = (e: MessageEvent): MessageEvent => {
        try {
          const m = JSON.parse(String(e.data)) as Msg;
          if (m.t !== 'hail') return e;
          delete m.progress;
          return { data: JSON.stringify(m) } as MessageEvent;
        } catch {
          return e;
        }
      };
      const OldHail = new Proxy(Real, {
        construct(target, args: [string]) {
          const ws = new target(...args);
          let handler: ((e: MessageEvent) => void) | null = null;
          Object.defineProperty(ws, 'onmessage', { configurable: true, get: () => handler, set: (fn: ((e: MessageEvent) => void) | null) => void (handler = fn) });
          ws.addEventListener('message', (e) => handler?.(strip(e as MessageEvent)));
          return ws;
        },
      });
      (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = OldHail;
      try {
        const syncsBefore = (await status()).progress.stats.syncs;
        const sentFrom = sent.length;
        const localBefore = progress.local;
        go();
        ok(await until(() => net.session.authority === 'server' && story.host === 'server', 8000), 'the browser connects and claims its character through a hail that says nothing of progress');
        ok(net.session.debug().progress === 0 && net.session.progressVersion === 0 && progress.host === 'local', 'and holds progress itself: the session read no progress in the hail, and the record stays this browser\'s');
        const old = progress.claim(claimOf([{ npc: 'test_relay_old' }]));
        ok(old.ok && !old.sent && progress.local === localBefore + 1, 'a fight claimed is paid here at once, a batch made alone');
        await wait(700);
        ok(!sent.slice(sentFrom).some((w) => w.what.startsWith('progress:')) && (await status()).progress.stats.syncs === syncsBefore, 'and not one word of progress went to the far end');
        net.disconnect();
        ok(await until(() => net.status === 'off' || net.session.authority !== 'server'), 'the line put down');
      } finally {
        (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = Real;
      }
    }

    // ---- a browser built before this: the hail's new field read past, the welcome once ---------------------------------
    {
      const { randomBytes } = await import('node:crypto');
      const { playerIdFor, proofFor, verifierFor } = await import('../../../server/identity.mjs');
      const key = new Uint8Array(randomBytes(32));
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const got: Msg[] = [];
      await new Promise<void>((done) => ws.addEventListener('open', () => done()));
      ws.addEventListener('message', (e) => got.push(JSON.parse(String((e as MessageEvent).data)) as Msg));
      await wait(150);
      const nonce = String(got.find((m) => m.t === 'hail')?.nonce ?? '');
      ws.send(JSON.stringify({ t: 'claim', player: playerIdFor(key), key: verifierFor(key), proof: proofFor(verifierFor(key), nonce), character: 'c-old', name: 'Old', counter: 1, about }));
      ws.send(JSON.stringify({ t: 'hello', name: 'Old', species: 'human_male', class: 'jedi', planet: 'tatooine', v: 6 }));
      await wait(300);
      ok(got.find((m) => m.t === 'hail')?.progress === 1 && got.filter((m) => m.t === 'welcome').length === 1 && !got.some((m) => m.t === 'progress'), 'a browser built before this is hailed with the new field, welcomed once, and told nothing of progress it never asked for');
      ws.close();
    }

    // ---- the worst hand-up there is, on one claim -------------------------------------------------------------------------
    // A character the server has never seen, whose browser holds all three at their largest: four hundred copies of the
    // longest id in its backpack, a story book of several pieces, and a progress record at every cap.
    record = { id: 'c-worst', name: 'Mon' };
    const longest = 'item_longest_'.padEnd(46, 'x');
    const t0 = Date.now();
    backpack = Array.from({ length: 400 }, (_, i) => ({ kind: 'weapon' as const, id: longest, got: t0 + i, thing: mintThing('weapon', longest, t0 + i) }));
    const flags: Record<string, number> = {};
    for (let i = 0; i < 800; i++) flags[`test_flag_${String(i).padStart(4, '0')}_`.padEnd(60, 'f')] = i;
    const book = { ...emptyBook('c-worst'), flags, local: 1, rev: 1 };
    shelf.set('swg.story.c-worst', JSON.stringify(book));
    const full = emptyRecord('c-worst');
    const h = (n: number) => n.toString(16).padStart(8, '0');
    const now = Math.round(Date.now() / 1000);
    const ch: unknown[] = [];
    for (const s of ['athletics', 'acrobatics', 'marksmanship', 'melee', 'fortitude', 'awareness', 'finesse'] as const) ch.push({ k: 'core', skill: s, xp: xpCap(PROGRESS_RULES) });
    ch.push({ k: 'pool', pool: 'demolitions', xp: PROGRESS_RULES.bankCap }, { k: 'earned', pool: 'demolitions', xp: 999999999 });
    ch.push(...grantChanges(full, 'demo.master', now - 100, PROGRESS_RULES).ch);
    for (let n = 0; n < PROGRESS_LIMITS.seen; n++) ch.push({ k: 'seen', key: h(n) });
    for (let n = 0; n < PROGRESS_LIMITS.recent; n++) ch.push({ k: 'recent', key: h(5000 + n), at: now - 200 + n, n: 99 });
    for (let n = 0; n < PROGRESS_LIMITS.paid; n++) ch.push({ k: 'paid', key: `e${(Date.now() - 200_000 + n).toString(36)}abcd`, at: now - 200 + n });
    for (let n = 0; n < PROGRESS_LIMITS.bonus; n++) ch.push({ k: 'bonus', key: h(9000 + n) });
    for (let n = 0; n < PROGRESS_LIMITS.log; n++) ch.push({ k: 'logRow', row: [now - 200_000 + n * 400, now - 200_000 + n * 400 + 299, n % 8, 99999] });
    applyProgress(full, ch);
    full.local = 1;
    shelf.set('swg.progress.c-worst', recordText(full));
    const fullText = recordText(full).length;
    const pieces = Math.ceil(fullText / PROGRESS_TUNE.offerChunk);
    story.use('c-worst');
    progress.use('c-worst');
    net.session.noteCharacter(marked(), about);
    const heldBefore = await held();
    const sentFrom = sent.length;
    go();
    ok(await until(() => progress.host === 'server' && story.host === 'server' && trade.known, 12000), `all three settled on one claim (the record ${fullText} characters in ${pieces} pieces)`);
    const s2 = await status();
    ok(net.status === 'online' && net.session.authority === 'server' && s2.connected >= 1, 'and the line stayed open the whole way through');
    ok(await held() === heldBefore + 400 && trade.list.length === 400, 'the backpack was taken whole: four hundred more things on the server');
    ok(story.stats.taken >= 1 && Object.keys(story.book!.flags ?? {}).length === 800 && story.stats.pieces >= 3, `the story book was taken whole from its ${story.stats.pieces} pieces`);
    ok(progress.stats.taken === 2 && (progress.record!.seen?.length ?? 0) === PROGRESS_LIMITS.seen && Object.keys(progress.record!.paid ?? {}).length === PROGRESS_LIMITS.paid && progress.record!.nodes['demo.master'] !== undefined, `and the progress record at every cap, taken whole from its ${pieces} pieces`);
    const mine = sent.slice(sentFrom);
    const firstOffer = mine.find((w) => w.what === 'progress:offer');
    const handUp = mine.find((w) => w.what === 'items:list');
    ok(!!firstOffer && !!handUp && firstOffer.at - handUp.at >= PROGRESS_TUNE.offerDelay - 100, `the record's first piece waited the offer's delay after the claim (${firstOffer ? firstOffer.at - (handUp?.at ?? 0) : '?'} ms after the backpack went up)`);
    let most = 0;
    for (let i = 0; i < mine.length; i++) {
      let sum = 0;
      for (let j = i; j < mine.length && mine[j].at - mine[i].at < 1000; j++) sum += mine[j].bytes;
      most = Math.max(most, sum);
    }
    const afterFirst = mine.filter((w) => w.at - (handUp?.at ?? 0) >= 1000);
    let mostAfter = 0;
    for (let i = 0; i < afterFirst.length; i++) {
      let sum = 0;
      for (let j = i; j < afterFirst.length && afterFirst[j].at - afterFirst[i].at < 1000; j++) sum += afterFirst[j].bytes;
      mostAfter = Math.max(mostAfter, sum);
    }
    note(`the most this browser sent in any one second was ${most} bytes (the relay drops news past 65536 and closes the line past 131072); after the first second ${mostAfter}`);
    ok(most < 131072 && mostAfter < 65536, 'never past what closes a line, and inside what a server takes in a second after the first: the record adds nothing to the first second at all');
    net.disconnect();
    await wait(200);
  } finally {
    clearInterval(stepper);
    console.log = log;
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the server still has it open: a temp folder either way */
      }
      console.log(`\n${passed} checks passed`);
      process.exit(0);
    }, 300);
  }
}
