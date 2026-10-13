// A house of yours moved where it stands, through a real relay and the browser's own socket (W7).
//
// `homes.test.ts` is the server's rules on their own and `homesBrowser.test.ts` the browser's; what neither can see
// is the glue -- the hail that says `homes: 2` reaching the session, `homeMoved` going through `src/net/net.ts`'s own
// switch (a word with no case there is dropped in silence), the move filed under the world the browser stands on,
// everybody on that world told and nobody else, every move the server will not act on answered naming its house so
// its browser stands it again, and what the relay writes down read back by a relay started again. So the relay runs
// here on a port of its own with its world in a temp folder, and every browser is the game's own `Net` and `Homes`,
// wired by the game's own `routeHomeWord`, over a world that counts every key it files.
//
// Run: node tools/swg/tests/homesMoveRelay.test.ts

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

if (typeof WebSocket === 'undefined') {
  console.log('     the relay round trip was skipped: this node has no WebSocket of its own');
  console.log(`\n${passed} checks passed`);
} else {
  const dir = mkdtempSync(join(tmpdir(), 'swg-homes-move-'));
  const port = 18881;
  process.env.PORT = String(port);
  // Its world goes in the temp folder and never in `server/data`, which is somebody's real world.
  process.argv.push(`--data=${dir}`);
  await import('../../../server/relay.mjs');
  const { HOMES_VERSION, HOME_SAYS, HOME_TUNING } = await import('../../../server/homes.mjs');
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  const shelfOf = () => {
    const shelf = new Map<string, string>();
    return { getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, String(v)), removeItem: (k: string) => void shelf.delete(k) };
  };
  const { Net } = await import('../../../src/net/net.ts');
  const { Homes, HOMES_MOVE_VERSION, homeKey, routeHomeWord } = await import('../../../src/net/homes.ts');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: () => boolean, ms = 4000) => {
    for (let t = 0; t < ms && !what(); t += 50) await wait(50);
    return what();
  };

  /**
   * A browser: the game's own socket and the game's own houses, every word handed over by the game's own router,
   * over a world that files each house under its key and counts every key filed over a copy already there.
   */
  function browser(name: string, character: string, planet: string, at = port) {
    g.localStorage = shelfOf();
    const net = new Net();
    void net.session.player;
    const filed = new Map<string, { x: number; z: number; yaw: number; y: number }>();
    let twice = 0;
    const said: string[] = [];
    const heard: Record<string, unknown>[] = [];
    const homes = new Homes();
    homes.attach({
      place: async (_model, o) => {
        if (filed.has(o.key)) twice++;
        filed.set(o.key, { x: o.at.x, z: o.at.z, yaw: o.yaw, y: o.y });
        return { ok: true, why: null };
      },
      unplace: (key) => filed.delete(key),
      say: (t) => void said.push(t),
      send: (msg) => net.sendWord(msg),
    });
    // As `main.ts` does it: whatever the socket hands over that it does not read itself goes through the router.
    net.onWord = (msg) => {
      const word = msg ? { ...msg } : msg;
      if (routeHomeWord(msg, homes) && word) heard.push(word);
    };
    homes.enter(`${planet}:`);
    net.session.noteCharacter({ id: character, name }, { species: 'human_male', class: 'jedi', planet, zone: '' });
    net.connect(`ws://127.0.0.1:${at}`, { name, species: 'human_male', class: 'jedi', planet });
    const heardOf = (t: string) => heard.filter((m) => m.t === t);
    return { net, homes, filed, said, heard, heardOf, twice: () => twice, spot: (id: string) => filed.get(homeKey(id)) };
  }

  const opened: { net: { disconnect(): void } }[] = [];
  try {
    const a = browser('Han', 'char-a', 'tatooine');
    opened.push(a);
    const b = browser('Chewie', 'char-b', 'tatooine');
    opened.push(b);
    const far = browser('Leia', 'char-c', 'naboo');
    opened.push(far);
    ok(await until(() => a.net.session.authority === 'server' && b.net.session.authority === 'server' && far.net.session.authority === 'server'), 'a real relay takes three browsers\' claims');
    ok(HOMES_VERSION === HOMES_MOVE_VERSION && a.net.session.homesVersion === 2 && b.net.session.homesVersion === 2, "the hail says homes: 2, the browser's own number for it, and it reaches the session through the socket's own switch");

    // One puts a house down.
    a.homes.ask('a_house', { x: 30, z: -40 }, 1, 14, 6.25);
    ok(await until(() => a.homes.rows.size === 1 && b.homes.rows.size === 1), 'a house goes up, and both on that world are told');
    const id = [...a.homes.rows.keys()][0];
    ok(await until(() => !!a.spot(id) && !!b.spot(id)), 'and it stands in both');

    // Its owner picks it up and puts it down somewhere else: it moves for everybody, once, under the same key.
    a.homes.hide(id);
    ok(!a.spot(id) && !!b.spot(id), "picked up, it comes down in its owner's browser alone");
    a.homes.askMove(id, { x: 120, z: -40 }, 2, 14, 7);
    ok(await until(() => a.spot(id)?.x === 120 && b.spot(id)?.x === 120), 'put down, it moves for both when the server answers');
    ok(a.spot(id)!.yaw === 2 && b.spot(id)!.y === 7 && a.homes.rows.get(id)!.owner === 'char-a' && b.homes.rows.size === 1, 'turned and raised as it was put down, still its owner\'s, still one house');
    ok(a.twice() === 0 && b.twice() === 0 && a.filed.size === 1 && b.filed.size === 1 && !a.homes.isHidden(id), 'filed once in each browser, the old one down before the new one up');
    ok(a.heardOf('homeMoved').length === 1 && b.heardOf('homeMoved').length === 1, 'by one word to each');
    await wait(150);
    ok(far.heardOf('homeMoved').length === 0 && far.homes.rows.size === 0, 'and nobody on another world hears of it');

    // Somebody else may not move it: refused, naming it, and it stands again for them where it stood.
    b.homes.hide(id);
    b.homes.askMove(id, { x: 600, z: 0 }, 0, 14, 2);
    ok(await until(() => b.heardOf('homeNo').some((m) => m.id === id) && b.spot(id)?.x === 120), "somebody else asking to move it is refused naming it, and it stands again for them where it stood");
    ok(b.said.some((s) => s.includes('not yours')) && a.spot(id)?.x === 120, "in the server's words, and it never moved for its owner");

    // Not onto somebody else's house; within its own old circle, yes.
    await wait(1100);
    b.homes.ask('a_house', { x: 500, z: 0 }, 0, 14, 1);
    ok(await until(() => a.homes.rows.size === 2), "another player's house goes up further along");
    const theirs = [...a.homes.rows.keys()].find((k) => k !== id)!;
    a.homes.hide(id);
    a.homes.askMove(id, { x: 505, z: 0 }, 0, 14, 1);
    ok(await until(() => a.heardOf('homeNo').some((m) => m.id === id) && a.spot(id)?.x === 120), 'moved onto another house, it is refused naming it and stands again where it stood');
    ok(b.spot(theirs)?.x === 500 && b.spot(id)?.x === 120, 'and neither house has moved anywhere');
    a.homes.hide(id);
    a.homes.askMove(id, { x: 123, z: -40 }, 2.5, 14, 7);
    ok(await until(() => a.spot(id)?.x === 123 && b.spot(id)?.x === 123), 'nudged within the circle it left, it moves: its own old circle is never in its way');

    // A move the server cannot read is answered naming its house, never dropped in silence.
    a.homes.hide(id);
    // A place that is not a number goes over the wire as nothing at all.
    a.homes.askMove(id, { x: Number.NaN, z: -40 }, 2.5, 14, 7);
    ok(await until(() => a.heardOf('homeNo').some((m) => m.id === id && m.why === HOME_SAYS.unread)), 'a move the server cannot read is answered to its asker, naming the house');
    ok(await until(() => a.spot(id)?.x === 123 && !a.homes.isHidden(id)), 'and its browser stands it again where it stood, by the refusal alone');

    // More moves than the server takes in a second: the ones over its window are each answered, naming the house.
    await wait(1100);
    const before = a.heardOf('homeMoved').length;
    const burst = HOME_TUNING.perSecond + 2;
    a.homes.hide(id);
    for (let i = 0; i < burst; i++) a.homes.askMove(id, { x: 130 + i, z: -40 }, 2.5, 14, 7);
    const last = 130 + HOME_TUNING.perSecond - 1;
    ok(await until(() => a.heardOf('homeMoved').length - before === HOME_TUNING.perSecond && a.heardOf('homeNo').filter((m) => m.id === id && m.why === HOME_SAYS.tooFast).length === 2), `a burst of ${burst} moves goes ${HOME_TUNING.perSecond} at a time, and the 2 past the window are each answered naming the house`);
    ok(await until(() => a.spot(id)?.x === last && b.spot(id)?.x === last), `and it stands where the last move the server took put it (x ${last}), in both`);
    ok(a.twice() === 0 && b.twice() === 0 && a.filed.size === 2 && b.filed.size === 2 && !a.homes.isHidden(id), 'every move filed once over the one before, never two copies of one key');

    // The status page counts the moves.
    const status = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { homes: { standing: number; moved: number; refusals: number } };
    ok(status.homes.standing === 2 && status.homes.moved === 2 + HOME_TUNING.perSecond && status.homes.refusals >= 5, `the status page counts the moves and the refusals (${JSON.stringify(status.homes)})`);

    // What the relay wrote down, read off its own folder (the log, or the snapshot its clock wrote and emptied it
    // into), and a relay started again on a copy of that folder, the way a power cut leaves it.
    const fileOf = (f: string) => (readdirSync(dir).includes(f) ? readFileSync(join(dir, f), 'utf8') : '');
    const records = fileOf('world.log')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as { t?: string; id?: string; home?: { x?: number } };
        } catch {
          return null;
        }
      });
    const snapText = fileOf('world.json');
    const snap = snapText ? (JSON.parse(snapText) as { houses?: Record<string, { x?: number }> }) : null;
    ok(records.some((r) => r?.t === 'home' && r.id === id && r.home?.x === last) || snap?.houses?.[id]?.x === last, 'the relay writes every move down as it happens');
    const copy = mkdtempSync(join(tmpdir(), 'swg-homes-move-restart-'));
    for (const f of readdirSync(dir)) copyFileSync(join(dir, f), join(copy, f));
    const port2 = port + 1;
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../server/relay.mjs', import.meta.url)), `--data=${copy}`, `--port=${port2}`], { stdio: 'ignore' });
    try {
      let back: ReturnType<typeof browser> | null = null;
      for (let tries = 0; tries < 40 && !back; tries++) {
        await wait(150);
        const tried = browser('Wedge', 'char-e', 'tatooine', port2);
        if (await until(() => tried.net.session.authority === 'server' && tried.heardOf('homes').length > 0, 600)) back = tried;
        else tried.net.disconnect();
      }
      ok(!!back, 'a relay started again on a copy of what the first wrote down takes a browser');
      opened.push(back!);
      ok(await until(() => back!.spot(id)?.x === last), 'and hands it the moved house where it was moved to');
      const row = back!.homes.rows.get(id)!;
      ok(row.owner === 'char-a' && row.model === 'a_house' && row.h === 2.5 && row.y === 7 && back!.homes.rows.size === 2, 'still its owner\'s, the same building, turned and raised as it was moved, beside the other');
      back!.homes.ask('a_house', { x: -900, z: 900 }, 0, 14, 0);
      ok(await until(() => back!.homes.rows.size === 3), 'and a house put down on it goes up');
      // The server hands its ids out in order from h1: the two houses put down were h1 and h2, so after every move
      // above and a restart, the next is h3 -- no move drew an id, and the counter came through the restart.
      const fresh = [...back!.homes.rows.keys()].find((k) => k !== id && k !== theirs)!;
      ok(id === 'h1' && theirs === 'h2' && fresh === 'h3', `under the very next id (${id}, ${theirs}, then ${fresh}): moving one made nothing new, and the restart kept the count`);
      back!.net.disconnect();
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
  } finally {
    for (const o of opened) o.net.disconnect();
    setTimeout(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the server still has it open: a temp folder either way */
      }
      console.log(`\n${passed} checks passed`);
      process.exit(0);
    }, 400);
  }
}
