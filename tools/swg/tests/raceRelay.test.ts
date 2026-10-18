// Racing together and another player's vehicle drawn where it is (the racer's wave 4a), through a real relay and the
// browser's own socket: the relay's greeting says it keeps a vehicle's motion and carries races; a vehicle's own
// velocity, turn and moment survive the relay and come out of the other browser's `onState`, while a state of the old
// shape still passes exactly as it was; and a race word goes to the sender's group and to nobody else, carrying who
// sent it, a word the relay will not keep going nowhere.
//
// The rule each half follows has tests of its own (vehicleWire.test.ts, raceTogether.test.ts, peerReckon.test.ts). What
// they cannot see is the relay's routing and the rebuild in `Net.receive`, so the relay is run here, on a port of its
// own and a world in a temp folder, and three of the browser's own `Net` talk through it: two in a group, one not.
//
// Run: node tools/swg/tests/raceRelay.test.ts
import assert from 'node:assert/strict';

let passed = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};

if (typeof WebSocket === 'undefined') {
  console.log('     the relay round trip was skipped: this node has no WebSocket of its own');
  console.log(`\n${passed} checks passed`);
} else {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'swg-race-relay-'));
  const port = 18798;
  process.env.PORT = String(port);
  // An empty folder for the packs too, so nothing of the game's own tables is read or printed.
  process.argv.push(`--data=${dir}`, `--assets=${dir}`);
  await import('../../../server/relay.mjs');
  // The browser's half needs a window's timers and somewhere to keep its key.
  const shelf = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, String(v)), removeItem: (k: string) => void shelf.delete(k) };
  g.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  const { Net } = await import('../../../src/net/net.ts');
  type PeerState = import('../../../src/net/net.ts').PeerState;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: () => boolean, ms = 4000) => {
    for (let t = 0; t < ms && !what(); t += 50) await wait(50);
    return what();
  };
  const browser = (name: string, character: string) => {
    const net = new Net();
    const heard: { id: number; state: PeerState }[] = [];
    const words: Record<string, unknown>[] = [];
    net.onState = (id, state) => void heard.push({ id, state });
    net.onWord = (msg) => void words.push(msg);
    net.session.noteCharacter({ id: character, name }, { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' });
    net.connect(`ws://127.0.0.1:${port}`, { name, species: 'human_male', class: 'jedi', planet: 'tatooine' });
    return { net, heard, words };
  };
  const a = browser('Ana', 'char-race-a');
  const b = browser('Bo', 'char-race-b');
  const c = browser('Cy', 'char-race-c');
  try {
    ok(await until(() => [a, b, c].every((x) => x.net.session.authority === 'server')), "a real relay takes the three browsers' claims");
    ok(a.net.session.raceVersion === 1 && a.net.session.vehVersion === 2, `its greeting says it carries races and keeps a vehicle's motion (race ${a.net.session.raceVersion}, veh ${a.net.session.vehVersion})`);
    ok(await until(() => a.net.id > 0 && b.net.id > 0 && c.net.id > 0 && a.net.peers.has(b.net.id) && b.net.peers.has(a.net.id) && c.net.peers.has(a.net.id)), `each knows the others (${a.net.id}, ${b.net.id}, ${c.net.id})`);
    // Standing within an invitation's reach of each other, so a group can be made.
    const at = (x: number) => ({ p: [x, 1, 0] as [number, number, number], h: 0, s: 'idle', v: 0, m: false, sab: false });
    a.net.sendState(at(0));
    b.net.sendState(at(5));
    c.net.sendState(at(10));
    await wait(200);

    // --- a vehicle's motion through the relay ---------------------------------------------------------------------
    const moment = Date.now() - 40;
    a.net.sendState({ ...at(0), m: true, veh: { id: 'pod_racer_one', p: [0, 1.5, 0], q: [0, 0, 0, 1], role: 'ride', vl: [0, 0, 97.5], yr: 0.75, at: moment } });
    ok(await until(() => b.heard.some((x) => x.id === a.net.id && x.state.veh?.vl !== undefined)), 'a state whose vehicle carries its motion arrives at the other browser');
    const moving = b.heard.filter((x) => x.id === a.net.id && x.state.veh?.vl).pop()!.state.veh!;
    ok(JSON.stringify(moving.vl) === '[0,0,97.5]' && moving.yr === 0.75 && moving.at === moment, `with its velocity, its turn and the moment its place was true as they were sent (${JSON.stringify({ vl: moving.vl, yr: moving.yr, at: moving.at })})`);
    const before = b.heard.length;
    a.net.sendState({ ...at(0), m: true, veh: { id: 'pod_racer_one', p: [0, 1.5, 3], q: [0, 0, 0, 1], role: 'ride' } });
    ok(await until(() => b.heard.length > before), 'a state of the old shape, a vehicle with no motion, still arrives');
    const plain = b.heard[b.heard.length - 1].state.veh!;
    ok(plain.vl === undefined && plain.yr === undefined && plain.at === undefined && plain.p[2] === 3, 'exactly as it was sent: no motion in it, its place as sent (a watcher glides it as before)');
    const badMotion = b.heard.length;
    a.net.sendState({ ...at(0), m: true, veh: { id: 'pod_racer_one', p: [0, 1.5, 6], q: [0, 0, 0, 1], role: 'ride', vl: [0, 0, 5000], yr: 0.75, at: moment } });
    ok(await until(() => b.heard.length > badMotion), 'a state whose motion is past what drives arrives');
    const cut = b.heard[b.heard.length - 1].state.veh!;
    ok(cut.vl === undefined && cut.at === undefined && cut.p[2] === 6, 'with its motion dropped whole and its vehicle kept');

    // --- a group, and the race word --------------------------------------------------------------------------------
    a.net.sendWord({ t: 'group', do: 'invite', to: b.net.id });
    ok(await until(() => b.words.some((w) => w.t === 'group' && w.do === 'invited')), 'the leader asks the second in');
    b.net.sendWord({ t: 'group', do: 'accept' });
    ok(await until(() => a.words.some((w) => w.t === 'group' && w.do === 'roster' && Array.isArray(w.members) && (w.members as unknown[]).length === 2)), 'and the two are a group');
    const call = { t: 'race', phase: 'call', world: 'tatooine', track: 'test_dune_loop', at: Date.now() + 20000, digest: 'c8256baf', laps: 3, members: [a.net.id, b.net.id] };
    a.net.sendWord(call);
    ok(await until(() => b.words.some((w) => w.t === 'race' && w.phase === 'call')), 'the leader\'s call reaches the other member');
    const heard = b.words.find((w) => w.t === 'race' && w.phase === 'call')!;
    ok(heard.id === a.net.id && heard.from === 'Ana' && heard.track === 'test_dune_loop' && heard.at === call.at && JSON.stringify(heard.members) === JSON.stringify(call.members), `carrying who sent it and the race as it was called (from ${heard.from}, members ${JSON.stringify(heard.members)})`);
    b.net.sendWord({ t: 'race', phase: 'lap', world: 'tatooine', track: 'test_dune_loop', at: call.at, n: 1, time: 61.5, total: 61.5 });
    ok(await until(() => a.words.some((w) => w.t === 'race' && w.phase === 'lap')), 'a member\'s lap reaches the leader');
    // A word the relay will not keep, and one from somebody in no group, go nowhere.
    b.net.sendWord({ t: 'race', phase: 'lap', world: 'tatooine', track: 'test_dune_loop', at: call.at, n: 0, time: 61.5, total: 61.5 });
    c.net.sendWord({ ...call, members: [c.net.id] });
    await wait(500);
    ok(a.words.filter((w) => w.t === 'race' && w.phase === 'lap').length === 1, 'a lap the relay will not keep (lap nought) goes nowhere');
    ok(!c.words.some((w) => w.t === 'race') && !a.words.some((w) => w.t === 'race' && w.id === c.net.id) && !b.words.some((w) => w.t === 'race' && w.id === c.net.id), 'and nobody outside the group hears the race, nor is heard by it');
    ok(!a.words.some((w) => w.t === 'race' && w.id === a.net.id), 'nor is a word sent back to the one who sent it');
  } finally {
    a.net.disconnect();
    b.net.disconnect();
    c.net.disconnect();
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the server still has it open: a temp folder either way */
      }
      console.log(`\nraceRelay: ${passed} checks passed`);
      process.exit(0);
    }, 200);
  }
}
