// The props a server keeps, through a real relay and the browser's own socket.
//
// `propsKept.test.ts` is the server's rules on their own and `propsKeeper.test.ts` the browser's; what neither
// can see is the glue -- the hail that says `props: 1` reaching the session, every word the server sends going
// through `src/net/net.ts`'s own switch (a word with no case there is dropped in silence, which once cost the
// purse every answer it was ever sent), the world a browser stands on being the one a prop is filed under,
// everybody on that world told and nobody else, somebody arriving later handed what is already there, every word
// the server will not act on answered rather than dropped, and what the relay writes down read back by a relay
// started again. So the relay itself runs here, on a port of its own with its world in a temp folder, and every
// browser is the game's own `Net` and `KeptProps`, wired by the game's own `keptDepsOf` and `routePropWord`.
//
// Run: node tools/swg/tests/propsRelay.test.ts

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
  const dir = mkdtempSync(join(tmpdir(), 'swg-props-relay-'));
  const port = 18861;
  process.env.PORT = String(port);
  // Its world goes in the temp folder and never in `server/data`, which is somebody's real world.
  process.argv.push(`--data=${dir}`);
  await import('../../../server/relay.mjs');
  const { PROP_SAYS, PROP_TUNING } = await import('../../../server/propsKept.mjs');
  // The browser's half needs a window's timers and somewhere to keep its key. Each browser is its own player:
  // its key is made (and kept) while its own storage is the one in place.
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  const shelfOf = () => {
    const shelf = new Map<string, string>();
    return { getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, String(v)), removeItem: (k: string) => void shelf.delete(k) };
  };
  const { Net } = await import('../../../src/net/net.ts');
  const { KeptProps, keptDepsOf, routePropWord } = await import('../../../src/net/propsKept.ts');
  type PlacedProp = import('../../../src/world/propsPlaced.ts').PlacedProp;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: () => boolean, ms = 4000) => {
    for (let t = 0; t < ms && !what(); t += 50) await wait(50);
    return what();
  };

  /**
   * A browser: the game's own socket and the game's own keeper of the server's props, wired by the game's own
   * builder and router, over a world that records what it stands.
   */
  function browser(name: string, character: string, planet: string, claim = true, at = port) {
    g.localStorage = shelfOf();
    const net = new Net();
    void net.session.player;
    const standing = new Map<string, PlacedProp>();
    const said: string[] = [];
    const heard: Record<string, unknown>[] = [];
    const kept = new KeptProps();
    kept.attach(
      keptDepsOf(
        () => ({ stand: async (r: PlacedProp) => (standing.set(r.thing, r), true), clear: (thing: string) => void standing.delete(thing) }),
        (t) => void said.push(t),
        net,
      ),
    );
    // As `main.ts` does it: whatever the socket hands over that it does not read itself goes through the router.
    net.onWord = (msg) => {
      const word = msg ? { ...msg } : msg;
      if (routePropWord(msg, kept) && word) heard.push(word);
    };
    // The world is in and the server keeps the player's props: the rows stand as they come.
    kept.enter(planet);
    kept.ready();
    if (claim) net.session.noteCharacter({ id: character, name }, { species: 'human_male', class: 'jedi', planet, zone: '' });
    net.connect(`ws://127.0.0.1:${at}`, { name, species: 'human_male', class: 'jedi', planet });
    const heardOf = (t: string) => heard.filter((m) => m.t === t);
    return { net, kept, standing, said, heard, heardOf };
  }

  const opened: { net: { disconnect(): void } }[] = [];
  try {
    const a = browser('Han', 'char-a', 'tatooine');
    opened.push(a);
    ok(await until(() => a.net.session.authority === 'server'), "a real relay takes the first browser's claim");
    const b = browser('Chewie', 'char-b', 'tatooine');
    opened.push(b);
    ok(await until(() => b.net.session.authority === 'server'), 'and the second\'s, another player on the same world');
    ok(a.net.session.propsVersion === 1 && b.net.session.propsVersion === 1, "the hail says props: 1, and it reaches the session through the socket's own switch");
    ok(await until(() => a.heardOf('props').length > 0 && b.heardOf('props').length > 0), 'each is handed the props on its world on arriving, an empty list included');
    const far = browser('Leia', 'char-c', 'naboo');
    opened.push(far);
    ok(await until(() => far.net.session.authority === 'server' && far.heardOf('props').length > 0), 'and so is somebody on another world');

    // One puts a chair down: both standing on that world see it, nobody elsewhere does.
    a.kept.ask('chair_s01', { x: 12, y: 3.5, z: -40 }, [0, 0.38268, 0, 0.92388], false);
    ok(await until(() => a.kept.rows.size === 1 && b.kept.rows.size === 1), 'one browser puts a prop down, and both on that world are told');
    const id = [...a.kept.rows.keys()][0];
    const row = a.kept.rows.get(id)!;
    ok(/^p\d+$/.test(id) && row.owner === 'char-a' && row.prop === 'chair_s01' && row.y === 3.5, 'under the server\'s id, filed under the character that put it down, at the height its browser stood it');
    ok(a.standing.has(`s:${id}`) && b.standing.has(`s:${id}`), 'and it stands in both');
    await wait(150);
    ok(far.kept.rows.size === 0 && far.heardOf('propUp').length === 0, 'and nobody on another world hears of it');
    ok(a.kept.mineNearest('char-a', { x: 12, y: 3.5, z: -40 }, 6)?.id === id && b.kept.mineNearest('char-b', { x: 12, y: 3.5, z: -40 }, 6) === null, 'its owner can pick it up and the other cannot');

    // The other may not take it away, or move it.
    b.kept.askDown(id);
    ok(await until(() => b.said.some((s) => s.includes('not yours'))), 'somebody else asking to take it away is refused in the server\'s words');
    ok(b.heardOf('propNo').some((m) => m.id === id), 'the refusal naming the row it was about');
    ok(await until(() => b.standing.has(`s:${id}`)) && a.kept.rows.has(id), 'and it stands again for them, and was never gone for its owner');
    b.kept.askMove(id, { x: 90, y: 3.5, z: -40 }, [0, 0, 0, 1], false);
    ok(await until(() => b.said.filter((s) => s.includes('not yours')).length === 2), 'nor may they move it');
    ok(await until(() => b.standing.get(`s:${id}`)?.x === 12), 'and it stands again for them where it stood');

    // Its owner picks it up and puts it down somewhere else: it moves for everybody, once.
    a.kept.hide(id);
    ok(!a.standing.has(`s:${id}`) && b.standing.has(`s:${id}`), "picked up, it comes down in its owner's browser alone");
    a.kept.askMove(id, { x: 20, y: 4, z: -44 }, [0, 0, 0, 1], true);
    ok(await until(() => a.standing.get(`s:${id}`)?.x === 20 && b.standing.get(`s:${id}`)?.x === 20), 'put down, it moves for both, when the server answers');
    ok(b.standing.get(`s:${id}`)?.inside === true && a.kept.rows.size === 1 && b.kept.rows.size === 1, 'once, with where it stands now');

    // A move the server cannot read is answered, naming its row, and the row stands again where it stood.
    a.kept.hide(id);
    a.kept.askMove(id, { x: Number.NaN, y: 4, z: -44 }, [0, 0, 0, 1], false);
    ok(await until(() => a.heardOf('propNo').some((m) => m.id === id && m.why === PROP_SAYS.unread)), 'a move the server cannot read is answered to its asker, naming its row, never dropped in silence');
    ok(await until(() => a.standing.get(`s:${id}`)?.x === 20) && a.kept.hiddenIds().length === 0, 'and the row stands again in its browser where it stood');

    // Out where only space reaches: a place 200 km from the middle is still a place.
    a.kept.ask('chair_s01', { x: 200000, y: 50, z: -120000 }, [0, 0, 0, 1], false);
    ok(await until(() => [...a.kept.rows.values()].some((r) => r.x === 200000)), 'a prop put down 200 km out (the made-up system reaches 125 km either way) is kept like any other');

    // Somebody arriving later is handed what is already there.
    const late = browser('Lando', 'char-d', 'tatooine');
    opened.push(late);
    ok(await until(() => late.kept.rows.has(id) && late.standing.get(`s:${id}`)?.x === 20), 'a browser arriving later is handed it, where it stands now');

    // A browser that has not said which character it plays owns nothing and puts nothing down.
    const nobody = browser('Nobody', '', 'tatooine', false);
    opened.push(nobody);
    await until(() => nobody.net.online && nobody.heardOf('props').length > 0);
    nobody.kept.ask('chair_s01', { x: 1, y: 0, z: 1 }, [0, 0, 0, 1], false);
    ok(await until(() => nobody.said.some((s) => s.includes('claimed'))), 'a browser with no character claimed is refused in words');
    ok(a.kept.rows.size === 2, 'and nothing went down');

    // More than the server takes in a second: every placing past it is refused once in words, and a removal past
    // it is answered naming its row, which stands again in its browser.
    await wait(1100);
    const before = a.heardOf('propUp').length;
    const burst = PROP_TUNING.perSecond + 3;
    for (let i = 0; i < burst; i++) a.kept.ask('crate_s01', { x: 300 + i, y: 1, z: 300 }, [0, 0, 0, 1], false);
    ok(await until(() => a.heardOf('propUp').length - before === PROP_TUNING.perSecond), `a burst of ${burst} placings goes down ${PROP_TUNING.perSecond} at a time, as the window allows`);
    await wait(200);
    const fast = a.heardOf('propNo').filter((m) => m.why === PROP_SAYS.tooFast);
    ok(fast.length === 1 && !('id' in fast[0]), `and the placings past it are refused once in words, naming no row (${fast.length})`);
    await wait(1100);
    for (let i = 0; i < 3; i++) a.kept.ask('crate_s01', { x: 320 + i, y: 1, z: 300 }, [0, 0, 0, 1], false);
    ok(await until(() => a.heardOf('propUp').length - before === PROP_TUNING.perSecond + 3), 'and the next second three more go down');
    await wait(1100);
    const crates = [...a.kept.rows.values()].filter((r) => r.prop === 'crate_s01').map((r) => r.id);
    const over = crates.length - PROP_TUNING.perSecond;
    for (const c of crates) a.kept.askDown(c);
    ok(over === 3 && (await until(() => a.heardOf('propNo').filter((m) => m.why === PROP_SAYS.tooFast && typeof m.id === 'string').length === over)), `taking all ${crates.length} away at once: each removal past the window is answered, naming its row`);
    ok(await until(() => crates.filter((c) => a.kept.rows.has(c)).length === over), `and ${over} are still the server's`);
    const kept = crates.filter((c) => a.kept.rows.has(c));
    ok(await until(() => kept.every((c) => a.standing.has(`s:${c}`)) && b.kept.rows.size >= over), "and those stand again in their owner's browser, as they still stand on the server and everywhere else");
    await wait(1100);
    for (const c of kept) a.kept.askDown(c);
    ok(await until(() => ![...a.kept.rows.values()].some((r) => r.prop === 'crate_s01')), 'and asked again a second later, they go');

    // Its owner takes the chair away: gone for everybody.
    a.kept.askDown(id);
    ok(await until(() => !a.kept.rows.has(id) && !b.kept.rows.has(id) && !late.kept.rows.has(id)), 'its owner takes it away, and it is gone for everybody on the world');
    ok(!a.standing.has(`s:${id}`) && !b.standing.has(`s:${id}`) && !late.standing.has(`s:${id}`), 'and nothing of it stands anywhere');

    // Two more, the newest taken away again: what a restart has to get right.
    await wait(1100);
    a.kept.ask('table_s01', { x: 40, y: 2, z: 40 }, [0, 0, 0, 1], false);
    ok(await until(() => [...a.kept.rows.values()].some((r) => r.prop === 'table_s01')), 'a table goes down');
    a.kept.ask('lamp_s01', { x: 42, y: 2, z: 40 }, [0, 0, 0, 1], false);
    ok(await until(() => [...a.kept.rows.values()].some((r) => r.prop === 'lamp_s01')), 'and a lamp beside it');
    const table = [...a.kept.rows.values()].find((r) => r.prop === 'table_s01')!.id;
    const lamp = [...a.kept.rows.values()].find((r) => r.prop === 'lamp_s01')!.id;
    a.kept.askDown(lamp);
    ok(await until(() => !a.kept.rows.has(lamp)), 'and the lamp, the newest of all, is taken away again');
    const handedOut = [...new Set(a.heardOf('propUp').map((m) => String((m.prop as { id: string }).id)))];

    // The status page counts what the server holds.
    const status = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { props: { standing: number; placed: number; moved: number; removed: number; refusals: number }; prop: Record<string, number> };
    ok(status.props.standing === 2 && status.props.moved === 1 && status.props.refusals >= 6, `the status page counts it (${JSON.stringify(status.props)}) and prints the numbers it works to (${JSON.stringify(status.prop)})`);

    // What the relay wrote down, read off its own folder: every prop placed and taken away is a record in its log,
    // and a relay started again on a copy of that folder -- the way a power cut leaves it -- has them all.
    // Read off the log, or the snapshot where the relay's own clock wrote one (every 30 s) and emptied the log.
    const fileOf = (f: string) => (readdirSync(dir).includes(f) ? readFileSync(join(dir, f), 'utf8') : '');
    const records = fileOf('world.log')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as { t?: string; id?: string };
        } catch {
          return null;
        }
      });
    const snapText = fileOf('world.json');
    const snap = snapText ? (JSON.parse(snapText) as { props?: Record<string, unknown>; propSeq?: number }) : null;
    const tableWritten = records.some((r) => r?.t === 'prop' && r.id === table) || !!snap?.props?.[table];
    const lampGone = records.some((r) => r?.t === 'propGone' && r.id === lamp) || (!!snap && !snap.props?.[lamp] && Number(snap.propSeq) > Number(lamp.slice(1)));
    ok(tableWritten && lampGone, 'the relay writes every prop put down and taken away as it happens');
    const copy = mkdtempSync(join(tmpdir(), 'swg-props-restart-'));
    for (const f of readdirSync(dir)) copyFileSync(join(dir, f), join(copy, f));
    const port2 = port + 1;
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../server/relay.mjs', import.meta.url)), `--data=${copy}`, `--port=${port2}`], { stdio: 'ignore' });
    try {
      let back: ReturnType<typeof browser> | null = null;
      for (let tries = 0; tries < 40 && !back; tries++) {
        await wait(150);
        const tried = browser('Wedge', 'char-e', 'tatooine', true, port2);
        if (await until(() => tried.net.session.authority === 'server' && tried.heardOf('props').length > 0, 600)) back = tried;
        else tried.net.disconnect();
      }
      ok(!!back, 'a relay started again on a copy of what the first wrote down takes a browser');
      opened.push(back!);
      const rows = [...back!.kept.rows.values()];
      ok(rows.length === 2 && back!.kept.rows.has(table) && !back!.kept.rows.has(lamp) && !back!.kept.rows.has(id), `and hands it exactly the props still standing, the table and the far chair, and none taken away (${rows.map((r) => r.id).join(', ')})`);
      ok(back!.kept.rows.get(table)?.owner === 'char-a' && back!.kept.rows.get(table)?.y === 2, 'each with whose it is and how high it stands');
      back!.kept.ask('stool_s01', { x: 5, y: 0, z: 5 }, [0, 0, 0, 1], false);
      ok(await until(() => [...back!.kept.rows.values()].some((r) => r.prop === 'stool_s01')), 'and a prop put down on it goes down');
      const fresh = [...back!.kept.rows.values()].find((r) => r.prop === 'stool_s01')!.id;
      const highest = Math.max(...handedOut.map((h) => Number(h.slice(1))));
      ok(!handedOut.includes(fresh) && Number(fresh.slice(1)) > highest, `under an id no prop has ever had, past the newest just taken away (${fresh} after ${lamp}, the highest ${highest})`);
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
