// A world's states through a real relay and the browser's own socket (server/worldState.mjs, src/net/net.ts): the
// relay's greeting carries the states it keeps; the admin's `worldStateSet` reaches a second browser as `worldStates`;
// a browser that is not the admin is refused, and so is a value the key does not allow; a look at the hail on a line
// of its own (`peekHail`, what a session's first arrival on Rori asks) reads the states and leaves nothing behind;
// and the state survives the relay's restart. The browser's and the server's tables of states are one.
//
// Run: node tools/swg/tests/worldStateRelay.test.ts
import assert from 'node:assert/strict';
import { WORLD_STATES as SERVER_STATES, WorldStates, applyWorldStates, cleanWorldStateSet } from '../../../server/worldState.mjs';
import { WORLD_STATES as BROWSER_STATES } from '../../../src/world/worldState.ts';

let passed = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};

// --- the server's own half, on its own --------------------------------------------------------------------------------
{
  ok(JSON.stringify(SERVER_STATES) === JSON.stringify(BROWSER_STATES), "the server's table of states is the browser's, key for key and value for value");
  ok(cleanWorldStateSet({ key: 'restuss', value: 'ruins' }).key === 'restuss' && !!cleanWorldStateSet({ key: 'restuss', value: 'rubble' }).why && !!cleanWorldStateSet({ key: '__proto__', value: 'x' }).why && !!cleanWorldStateSet(null).why, 'a word is a key it keeps and a value that key allows, or why not');
  const written: Record<string, unknown>[] = [];
  const states = new WorldStates({ write: (rec: Record<string, unknown>) => void written.push(rec) });
  states.load({});
  ok(states.hail().restuss === 'ruins', 'a world nobody has changed stands Restuss in ruins');
  const set = states.set({ key: 'restuss', value: 'living' });
  ok(set.ok && set.changed && set.states.restuss === 'living' && written.length === 1 && written[0].t === 'worldState', 'the admin\'s word is taken and written as a record of its own');
  ok(states.set({ key: 'restuss', value: 'living' }).changed === false && written.length === 1, 'the same word again is answered and written nowhere');
  const data: Record<string, unknown> = {};
  ok(applyWorldStates(data, written[0]) && (data.worldStates as Record<string, string>).restuss === 'living' && !applyWorldStates(data, { t: 'worldState', key: 'restuss', value: 'rubble' }) && !applyWorldStates(data, { t: 'other' }), 'the store applies it, and refuses a record naming a value the key does not allow');
}

if (typeof WebSocket === 'undefined') {
  console.log('     the relay round trip was skipped: this node has no WebSocket of its own');
  console.log(`\n${passed} checks passed`);
} else {
  const { copyFileSync, mkdtempSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'swg-world-states-'));
  const port = 18803;
  process.env.PORT = String(port);
  // An empty folder for the packs too, so nothing of the game's own tables is read or printed.
  process.argv.push(`--data=${dir}`, `--assets=${dir}`);
  await import('../../../server/relay.mjs');
  // Each browser is a player of its own: its key is made (and kept) while its own storage is the one in place.
  const g = globalThis as unknown as Record<string, unknown>;
  const shelfOf = () => {
    const shelf = new Map<string, string>();
    return { getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, String(v)), removeItem: (k: string) => void shelf.delete(k) };
  };
  g.localStorage = shelfOf();
  g.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  const { Net, peekHail } = await import('../../../src/net/net.ts');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: () => boolean | Promise<boolean>, ms = 4000) => {
    for (let t = 0; t < ms && !(await what()); t += 50) await wait(50);
    return what();
  };
  const browser = (name: string, character: string, at = port) => {
    g.localStorage = shelfOf();
    const net = new Net();
    void net.session.player;
    const heard: { states: Record<string, string> | null; why: string }[] = [];
    const notices: string[] = [];
    net.onStates = (states, why) => void heard.push({ states, why });
    net.onNotice = (text) => void notices.push(text);
    net.session.noteCharacter({ id: character, name }, { species: 'human_male', class: 'jedi', planet: 'rori', zone: '' });
    net.connect(`ws://127.0.0.1:${at}`, { name, species: 'human_male', class: 'jedi', planet: 'rori' });
    return { net, heard, notices };
  };
  const opened: ReturnType<typeof browser>[] = [];
  try {
    // A look at the hail before anybody has claimed: the states, and nothing left of the line on the server.
    const peeked = await peekHail(`ws://127.0.0.1:${port}`, 3000);
    ok(!!peeked && peeked.t === 'hail' && (peeked.states as Record<string, string>)?.restuss === 'ruins', "a look at the hail on a line of its own reads the states the server keeps");
    // And leaves nothing behind: the line it opened is closed, so the server holds no connection for it (its own
    // status page counts every one it holds).
    const connected = async (): Promise<number> => ((await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { connected: number }).connected;
    ok(await until(async () => (await connected()) === 0, 3000) && (await connected()) === 0, 'and the line it opened for that is closed again, the server holding nothing of it');
    ok((await peekHail('ws://127.0.0.1:1', 600)) === null, 'and a far end that is not there answers nothing, within its wait');

    // The first player this world meets is its admin.
    const a = browser('Ana', 'char-state-a');
    opened.push(a);
    ok(await until(() => a.net.session.authority === 'server'), 'a real relay takes the first browser\'s claim');
    ok(a.net.session.debug().admin === true, 'and it is the admin of this world');
    ok(a.heard.some((h) => h.why === 'hail' && h.states?.restuss === 'ruins') && a.net.session.worldStates?.restuss === 'ruins', "its greeting carries the states it keeps, which the browser's socket hands on");
    const b = browser('Bo', 'char-state-b');
    opened.push(b);
    ok(await until(() => b.net.session.authority === 'server' && b.net.id > 0 && a.net.id > 0), 'a second browser joins');
    ok(b.net.session.debug().admin === false, 'and is not the admin');

    // The admin's word reaches everybody.
    ok(a.net.setWorldState('restuss', 'living'), 'the admin asks for the living Restuss');
    ok(await until(() => b.heard.some((h) => h.why === 'word' && h.states?.restuss === 'living')), 'the other browser is told, as `worldStates`');
    ok(b.net.session.worldStates?.restuss === 'living' && a.heard.some((h) => h.why === 'word' && h.states?.restuss === 'living'), 'and the admin too, and each session keeps it');

    // Refused: not the admin, and a value the key does not allow.
    const heardBefore = a.heard.length;
    b.net.setWorldState('restuss', 'ruins');
    ok(await until(() => b.notices.some((t) => /only this world.s admin/.test(t))) && !a.notices.some((t) => /only this world.s admin/.test(t)), 'a browser that is not the admin is refused, in words, to it alone');
    a.net.setWorldState('restuss', 'rubble');
    ok(await until(() => a.notices.some((t) => /restuss is living or ruins/.test(t))), 'a value the key does not allow is refused');
    await wait(300);
    ok(a.heard.length === heardBefore && b.net.session.worldStates?.restuss === 'living', 'and neither moved anything for anybody');

    // Put down on purpose, a browser's states go back to its own.
    b.net.disconnect();
    ok(b.heard[b.heard.length - 1].states === null && b.heard[b.heard.length - 1].why === 'gone', 'a line put down hands back no states, so the browser keeps its own setting');

    // A restart keeps the admin's word.
    await wait(200);
    const copy = mkdtempSync(join(tmpdir(), 'swg-world-states-restart-'));
    for (const f of readdirSync(dir)) copyFileSync(join(dir, f), join(copy, f));
    const port2 = port + 1;
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../server/relay.mjs', import.meta.url)), `--data=${copy}`, `--assets=${copy}`, `--port=${port2}`], { stdio: 'ignore' });
    try {
      let hail: Record<string, unknown> | null = null;
      for (let tries = 0; tries < 40 && !hail; tries++) {
        await wait(150);
        hail = await peekHail(`ws://127.0.0.1:${port2}`, 500);
      }
      ok(!!hail && (hail.states as Record<string, string>)?.restuss === 'living', 'a relay started again on what the first wrote down hails the living Restuss still');
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
      console.log(`\nworldStateRelay: ${passed} checks passed`);
      process.exit(0);
    }, 400);
  }
}
