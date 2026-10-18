// Another player's grappling hook, through a real relay and the browser's own socket (the design's §3.15, wave 4): a
// state carrying a rope (`gr`), the points of it on a third player's vehicle (`grf`) and a thrown blade (`tb`) comes
// out of the other browser's `onState` with all three; a state with none comes out with none; a relay that knows the
// rope and not its frames passes `gr` and never `grf`; the relay's greeting says its ledger keeps gear; and the wire's
// cap on a rope's points is the browser's own.
//
// The rule each half follows has tests of its own (netWire.test.ts, remoteRopes.test.ts). What they cannot see is the
// rebuild in `Net.receive`, which once left the thrown blade out of every live state: nobody ever saw another
// player's saber in flight, and no test sent one through the socket. So the relay is run here, on a port of its own and
// a world in a temp folder, and two of the browser's own `Net` talk through it.
//
// Run: node tools/swg/tests/grappleRelay.test.ts
import assert from 'node:assert/strict';

let passed = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};

{
  // The wire's cap and the browser's: a rope cut to fewer is always accepted, one longer is dropped whole, so they must agree.
  const { WIRE } = await import('../../../server/wire.mjs');
  const { ROPE_POINTS } = await import('../../../server/grappleWire.mjs');
  const { ROPE_WIRE_POINTS, GRAPPLE_TUNE, tuneGrapple, resetGrappleTune } = await import('../../../src/player/grapple.ts');
  const { PEER_ROPE_POINTS } = await import('../../../src/net/peerRope.ts');
  ok(WIRE.ropePoints === ROPE_POINTS && ROPE_POINTS === ROPE_WIRE_POINTS && ROPE_WIRE_POINTS === PEER_ROPE_POINTS, `the relay's cap on a rope's points is the browser's own, sent and read (${WIRE.ropePoints})`);
  tuneGrapple({ sendPoints: 40 });
  ok(GRAPPLE_TUNE.sendPoints === ROPE_WIRE_POINTS, `and the browser's own cut is held at it or under (${GRAPPLE_TUNE.sendPoints} asked for 40)`);
  resetGrappleTune();
}

if (typeof WebSocket === 'undefined') {
  console.log('     the relay round trip was skipped: this node has no WebSocket of its own');
  console.log(`\n${passed} checks passed`);
} else {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'swg-grapple-relay-'));
  const port = 18797;
  process.env.PORT = String(port);
  process.argv.push(`--data=${dir}`);
  const { ROPE_WIRE } = await import('../../../server/grappleWire.mjs');
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
    net.onState = (id, state) => void heard.push({ id, state });
    net.session.noteCharacter({ id: character, name }, { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' });
    net.connect(`ws://127.0.0.1:${port}`, { name, species: 'human_male', class: 'jedi', planet: 'tatooine' });
    return { net, heard };
  };
  const a = browser('Han', 'char-grapple-a');
  const b = browser('Leia', 'char-grapple-b');
  try {
    ok(await until(() => a.net.session.authority === 'server' && b.net.session.authority === 'server'), 'a real relay takes both browsers\' claims');
    ok(a.net.session.gearVersion === 1 && b.net.session.gearVersion === 1, `and its greeting says its ledger keeps carried gear (gear ${a.net.session.gearVersion})`);
    ok(await until(() => a.net.id > 0 && b.net.id > 0 && a.net.peers.has(b.net.id) && b.net.peers.has(a.net.id)), `each knows the other (${a.net.id} and ${b.net.id})`);
    // A third player's vehicle, by a relay id that is not the sender's: the points of the rope that ride it.
    const third = b.net.id + 100;
    const gr = [1, 0.35, 10, 2, 5, 11.5, 3, 6.25, 12, 1.5, 7];
    const grf = [1, third, 0, 0.5, 1.25, -2];
    const tb = [4, 1.5, -3, 2.25];
    const base = { p: [1, 2, 3] as [number, number, number], h: 0.5, s: 'air', v: 6, m: false, sab: true };
    a.net.sendState({ ...base, gr, grf, tb: tb as [number, number, number, number] });
    ok(await until(() => b.heard.some((x) => x.id === a.net.id && !!x.state.gr)), 'a state carrying a rope arrives at the other browser');
    const got = b.heard.filter((x) => x.id === a.net.id && x.state.gr).pop()!.state;
    ok(JSON.stringify(got.gr) === JSON.stringify(gr), `with its rope as it was sent (${JSON.stringify(got.gr)})`);
    ok(JSON.stringify(got.grf) === JSON.stringify(grf), `with the point that rides a third player's vehicle (${JSON.stringify(got.grf)})`);
    ok(JSON.stringify(got.tb) === JSON.stringify(tb), `and with the blade in the air, which this rebuild once left out of every state (${JSON.stringify(got.tb)})`);
    // The dart flying: seven numbers, no frames.
    const dart = [0, 5, 6, 7, 100, 20, -40];
    a.net.sendState({ ...base, gr: dart });
    ok(await until(() => JSON.stringify(b.heard[b.heard.length - 1]?.state.gr) === JSON.stringify(dart)), 'a dart in flight arrives as it was sent');
    ok(b.heard[b.heard.length - 1].state.grf === undefined, 'with no frames beside it');
    // A state with none of them.
    const before = b.heard.length;
    a.net.sendState({ ...base });
    ok(await until(() => b.heard.length > before), 'a state with no rope arrives');
    const none = b.heard[b.heard.length - 1].state;
    ok(none.gr === undefined && none.grf === undefined && none.tb === undefined, 'with no rope, no frames and no blade in it');
    // An entry naming the sender is dropped on its own; the rope stands.
    const self = [1, a.net.id, 1, 0, 0, 0];
    a.net.sendState({ ...base, gr, grf: [...self, ...grf] });
    ok(await until(() => b.heard[b.heard.length - 1]?.state.gr !== undefined && b.heard.length > before + 1), 'a rope naming its own sender\'s vehicle arrives');
    ok(JSON.stringify(b.heard[b.heard.length - 1].state.grf) === JSON.stringify(grf), 'with the entry naming the sender taken out and the other kept: nobody ropes the vehicle they are on');
    // A relay that knows the rope and not its frames: the rope still arrives, its frames never.
    ROPE_WIRE.frames = false;
    const n = b.heard.length;
    a.net.sendState({ ...base, gr, grf, tb: tb as [number, number, number, number] });
    ok(await until(() => b.heard.length > n), 'against a relay that knows the rope and not its frames, the state still arrives');
    const older = b.heard[b.heard.length - 1].state;
    ok(JSON.stringify(older.gr) === JSON.stringify(gr) && older.grf === undefined, 'with its rope, and with no frames: a watcher draws the world points');
    ROPE_WIRE.frames = true;
  } finally {
    a.net.disconnect();
    b.net.disconnect();
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
