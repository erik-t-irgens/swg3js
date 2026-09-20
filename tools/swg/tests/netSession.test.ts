// The socket's half of joining: what a browser says when it opens a line, in what order, what it makes
// of a server that holds the world against one that only passes words along, and the one rule that cost
// a live-lock in the design -- a browser told its character was opened somewhere else must stop asking
// for it back.
//
// Four failures are pinned here. A browser that kept reconnecting after being taken over would take the
// character off the newer browser, which would take it back, for ever. A hello sent before the claim is
// simply dropped by a server started with a join word, and never sent again, so the order is the thing
// being tested, not a detail. A browser talking to the relay that came before must still join it, which
// means the wait cannot be skipped and cannot be forgotten. And the world's clock must be taken from a
// server that has one, kept when the line drops, and let go of when the line is put down.
//
// Everything is synthetic: the socket is a fake, the window is four timer functions, and no server is
// started. `src/net/net.ts` imports nothing but its own types, the session and the shared clock, so it
// runs here as it is.
import assert from 'node:assert/strict';
import { tuneSession } from '../../../src/net/session.ts';
import { sharedClock } from '../../../src/world/sharedClock.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A socket that goes nowhere: every frame it is given is kept, and the test plays the server. */
class FakeSocket {
  static OPEN = 1;
  static made: FakeSocket[] = [];
  readyState = 1;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.made.push(this);
  }
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  /** The server says something. */
  say(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** Every message this browser has sent, parsed. */
  words(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
  word(t: string): Record<string, unknown> | undefined {
    return this.words().find((m) => m.t === t);
  }
  /** Where a kind of message stands in the order they went, or -1. */
  at(t: string): number {
    return this.words().findIndex((m) => m.t === t);
  }
}

const g = globalThis as unknown as Record<string, unknown>;
g.WebSocket = FakeSocket;
g.window = { setTimeout, clearTimeout, setInterval, clearInterval };

const { Net } = await import('../../../src/net/net.ts');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The wait for a server's first word is a second in play; here it is short enough to test.
tuneSession({ hailWait: 30 });

const HELLO = { name: 'Han', species: 'human_male', class: 'jedi' as const, planet: 'tatooine' };
const NONCE = '00112233445566778899aabbccddeeff';

/** Every net the test made, so its timers are stopped at the end rather than holding the process open. */
const nets: { disconnect(): void }[] = [];

/** A net with a line open and the fakes counted from now. A join word is set only where it is tested. */
function open(url = 'ws://test:8787', word = '') {
  FakeSocket.made.length = 0;
  const net = new Net();
  nets.push(net);
  const notices: string[] = [];
  net.onNotice = (t) => void notices.push(t);
  net.session.setWord(word);
  net.session.noteCharacter({ id: 'char-1', name: 'Han' }, { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' });
  net.connect(url, HELLO);
  const sock = FakeSocket.made[0];
  sock.onopen?.();
  return { net, sock, notices };
}

{
  // With no join word nothing waits: the hello goes the moment the line opens, as it always did.
  const { net, sock } = open();
  const hello = sock.word('hello');
  ok(!!hello, 'the hello goes at once when no join word is set, as it always did');
  ok(hello!.v === 2, 'and says which language this browser speaks');
  ok(hello!.name === 'Han' && hello!.planet === 'tatooine', 'while carrying everything it always carried');
  ok(net.session.mode === 'waiting', 'though nothing is known about the server yet');
  await sleep(60);
  ok(net.session.mode === 'relay', 'and silence past the wait reads as the relay that came before');
  ok(!sharedClock.shared, 'whose clock is nobody’s but this browser’s');
}

{
  // The old relay answers the hello with a welcome and says nothing else.
  const { net, sock, notices } = open();
  await sleep(60);
  const joined: number[] = [];
  net.onJoin = (p) => void joined.push(p.id);
  sock.say({ t: 'welcome', id: 7, peers: [{ id: 2, hello: HELLO, state: null }] });
  ok(net.id === 7, 'the welcome still gives this browser its number');
  ok(joined.length === 1 && joined[0] === 2, 'and everyone already there is still brought in');
  ok(net.session.authority === 'me', 'this browser decides everything for itself on a relay');
  ok(notices.some((n) => /relay/.test(n)), 'and the player is told which kind of line this is');
  ok(net.online, 'the line is up either way');
}

{
  // A server that holds the world.
  const { net, sock, notices } = open();
  sock.say({ t: 'hail', v: 2, now: Date.now() + 5000, epoch: 1, dayMs: 720000, nonce: NONCE, word: 0, ff: 0 });
  const claim = sock.word('claim')!;
  ok(typeof claim.player === 'string' && typeof claim.proof === 'string' && typeof claim.key === 'string', 'the claim names this player and proves it');
  ok(claim.word === undefined, 'a server that asks for no join word is sent no proof of one');
  ok(!!sock.word('ping'), 'the clock’s first round trip goes with it');
  ok(sharedClock.shared, 'and the world’s clock is the server’s from the greeting');
  ok(Math.abs(sharedClock.now() - Date.now() - 5000) < 200, 'even before a round trip has come back');
  const ping = sock.word('ping')!;
  sock.say({ t: 'pong', c: Number(ping.c), s: Number(ping.c) + 5000 });
  ok(sharedClock.report().samples === 2, 'the answer sharpens it');
  sock.say({ t: 'claimed', you: { player: String(claim.player), character: 'char-1', name: 'Han' }, keep: 'browser' });
  ok(net.session.mode === 'server' && net.session.authority === 'server', 'the claim being answered is what makes this a server session');
  ok(notices.some((n) => /joined/.test(n)), 'and the player is told');
  sock.say({ t: 'welcome', id: 3, v: 2, now: Date.now(), ff: 1, peers: [] });
  ok(net.session.friendlyFire, 'the welcome brings the friendly-fire switch');
  await sleep(60);
  ok(net.session.mode === 'server', 'and the wait for a first word does not undo a server that spoke');
  // A line that drops keeps the clock; one put down on purpose lets it go.
  sock.close();
  ok(sharedClock.where === 'adrift', 'a line that drops leaves the day carrying on at its own rate');
  net.disconnect();
  ok(!sharedClock.shared, 'and putting it down on purpose gives the day back to this browser');
}

{
  // With a join word the hello waits, because such a server drops everything until it knows who is there.
  const { sock } = open('ws://test:8787', 'mos-eisley');
  ok(sock.word('hello') === undefined, 'with a join word nothing is said until the server has spoken');
  sock.say({ t: 'hail', v: 2, now: Date.now(), nonce: NONCE, word: 1 });
  ok(sock.at('claim') === 0 && sock.at('hello') === 1, 'and then the claim goes first and the hello follows it');
  ok(typeof sock.word('claim')!.word === 'string', 'with the word proved rather than sent');
}

{
  // A hail that turns up after the wait has run out, on a server that asks for a join word. The hello
  // went on the guess that this was the old relay, and such a server threw it away without a word: if
  // it is not said again this browser sits on the server with no record at all -- every state it sends
  // dropped, invisible to everyone including itself, and nothing in the game to say why.
  const { net, sock } = open('ws://test:8787', 'mos-eisley');
  await sleep(60);
  ok(sock.words().filter((m) => m.t === 'hello').length === 1, 'the wait running out sends the hello, on the guess that this is the relay that came before');
  ok(net.session.mode === 'relay', 'and the session says so');
  sock.say({ t: 'hail', v: 2, now: Date.now(), nonce: NONCE, word: 1 });
  const said = sock.words().map((m) => m.t);
  ok(net.session.mode === 'server', 'a greeting that comes late is still a server');
  ok(said.filter((t) => t === 'hello').length === 2, 'and the hello is said again, because a server with a join word dropped the first');
  ok(said.indexOf('claim') < said.lastIndexOf('hello'), 'after the claim this time, which is the only order such a server listens in');
  net.disconnect();
}

{
  // The same lateness on a server that asks for no word: it kept the first hello, and a second would
  // cost this browser the welcome it is owed, since only the first hello brings one.
  const { net, sock } = open();
  await sleep(60);
  sock.say({ t: 'hail', v: 2, now: Date.now(), nonce: NONCE, word: 0 });
  ok(sock.words().filter((m) => m.t === 'hello').length === 1, 'a server that asks for no word is not sent the hello twice');
  ok(sock.at('hello') === 0 && sock.at('claim') > 0, 'the hello that went at once stands, and the claim follows it');
  net.disconnect();
}

{
  // Taken over: the older browser stops, and must not come back for the character (decision 8).
  const { net, sock, notices } = open();
  sock.say({ t: 'hail', v: 2, now: Date.now(), nonce: NONCE });
  sock.say({ t: 'claimed', you: { player: net.session.player, character: 'char-1' }, keep: 'same' });
  const before = FakeSocket.made.length;
  ok(sharedClock.shared, 'the greeting put the day on the server’s clock');
  sock.say({ t: 'taken', by: 'Han' });
  ok(!net.online && net.status === 'off', 'the line is put down');
  // Being taken over is not a line that dropped: this browser is out of that world, so it takes its
  // own clock back rather than keeping a stranger's offset for the life of the page.
  ok(sharedClock.where === 'off', 'and the day goes back to this browser’s own clock rather than staying adrift on the server’s');
  ok(notices.some((n) => /another browser/.test(n)), 'and says so in words the player reads');
  await sleep(1300);
  ok(FakeSocket.made.length === before, 'and it does not open another line, however long it waits');
  ok(net.session.debug().taken, 'which the console can see');
  net.connect('ws://test:8787', HELLO);
  ok(FakeSocket.made.length === before + 1, 'asking to connect again is the one thing that undoes it');
  net.disconnect();
}

{
  // A server that turns this browser away stops it the same way, in the server's own words.
  const { net, sock, notices } = open('ws://test:8787', 'wrong');
  sock.say({ t: 'hail', v: 2, now: Date.now(), nonce: NONCE, word: 1 });
  const before = FakeSocket.made.length;
  ok(sharedClock.shared, 'the greeting put the day on the server’s clock before the refusal came');
  sock.say({ t: 'denied', why: 'the join word is wrong' });
  ok(net.status === 'off', 'being turned away puts the line down');
  ok(notices.some((n) => /join word is wrong/.test(n)), 'in the words the server used');
  // A server whose machine clock is an hour out would otherwise move this player's time of day by an
  // hour, permanently, for refusing them.
  ok(sharedClock.where === 'off', 'and a browser turned away keeps none of that server’s clock');
  await sleep(1300);
  ok(FakeSocket.made.length === before, 'and it is not asked again');
}

{
  // A character another player owns: the line stands and only the character is refused, so the player
  // has to be told or they sit on an open line that will never welcome them, with nothing to say why.
  const { net, sock, notices } = open();
  sock.say({ t: 'hail', v: 2, now: Date.now(), nonce: NONCE });
  sock.say({ t: 'refused', why: 'that character belongs to another player' });
  ok(net.online, 'the line is left open, because this browser is still itself');
  ok(notices.some((n) => /another player/.test(n)), 'and the player is told in the server’s own words');
  ok(notices.some((n) => /Switch character/.test(n)), 'and told what to do about it');
  ok(net.session.debug().refused !== '', 'which the console can see');
  net.disconnect();
}

{
  // The character settled, and the question when it cannot be.
  const { net, sock } = open();
  const asked: unknown[] = [];
  net.session.onAsk = (a) => void asked.push(a);
  sock.say({ t: 'hail', v: 2, now: Date.now(), nonce: NONCE });
  const copy = { name: 'Han', species: 'human_male', class: 'jedi', planet: 'naboo', zone: '', counter: 1 };
  sock.say({ t: 'settle', character: 'char-1', browser: { ...copy, planet: 'tatooine' }, server: copy });
  ok(net.session.ask?.character === 'char-1', 'a tie comes through as a question');
  net.session.resolveAsk('server');
  ok(sock.word('settle')!.take === 'server', 'and the answer goes back in the server’s own words');
  sock.say({ t: 'settled', character: 'char-1', take: 'server', record: copy });
  ok(net.session.ask === null, 'a question answered for us clears it too');
  net.disconnect();
}

{
  // An ordinary drop still reconnects, which is what it has always done.
  const { sock } = open();
  await sleep(60);
  sock.say({ t: 'welcome', id: 1, peers: [] });
  const before = FakeSocket.made.length;
  sock.close();
  await sleep(1300);
  ok(FakeSocket.made.length === before + 1, 'a line that simply dropped is opened again');
}

{
  // Words from a build this one does not know do nothing at all.
  const { net, sock } = open();
  sock.say({ t: 'something-else', whatever: [1, 2, 3] });
  sock.say({ t: 'settle' });
  sock.say({ t: 'settled' });
  ok(net.session.ask === null && net.status !== 'off', 'a word this browser does not understand is simply dropped');
}

// Every line put down: a session that is still up holds the clock's round trips going, which in a
// browser ends with the page and here would hold the test open.
for (const net of nets) net.disconnect();

console.log(`\n${checks} checks passed`);
