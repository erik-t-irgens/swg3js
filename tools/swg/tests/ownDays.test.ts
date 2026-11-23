// The worlds that keep their own day under an applied star system, on the server (the GPU port's pass 2, wave 5, maker S; the
// owner's answer of 21 November: one steady spin per world, night as long as day): `server/clock.mjs`' `WorldDays` and
// `ownDayFraction`, the story's hour (`server/storyWorlds.mjs`), and a real relay reading a bodies file (`--bodies`), handing
// the worlds' days in its hail and their hours on its status page, two browsers' own `Net` taking the hail, every hour the very
// sum the browser's day makes of the shared clock (`SharedClock.ownTimeOfDay`).
//
// Run: node tools/swg/tests/ownDays.test.ts
import assert from 'node:assert/strict';
import { draftSystem } from '../../../src/sky/system/drafts.js';
import { worldDaysOf, worldHourAt, SERVER_WORLD_DAYS, takeServerDays } from '../../../src/sky/system/worldDays.ts';
import { WorldClock, WorldDays, ownDayFraction } from '../../../server/clock.mjs';
import { storyWorlds } from '../../../server/storyWorlds.mjs';
import { SharedClock } from '../../../src/world/sharedClock.ts';
import { hourOfDay } from '../../../src/world/dayPhase.ts';

let passed = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};

const systems = { yavin: draftSystem('yavin'), naboo: draftSystem('naboo') };
const table = worldDaysOf(systems);
{
  ok(Object.keys(table).sort().join(',') === 'naboo,otoh_gunga,rori,yavin4', `every ground world of the applied systems keeps its own day (${Object.keys(table).sort().join(', ')})`);
  const days = new WorldDays(table);
  ok(days.of('yavin4')?.lengthSeconds === 4 * 3600 && days.of('tatooine') === null && days.of('constructor') === null, "a world's own day by its pack; a world no system holds, or a word that is no world, has none");
  ok(new WorldDays({ bad: { lengthSeconds: 0.2, phase: 0 }, BAD: { lengthSeconds: 3600, phase: 0 }, ok_one: { lengthSeconds: 7200, phase: Number.NaN }, fine: { lengthSeconds: 7200, phase: -3 } }).hand().fine?.[0] === 7_200_000, 'a table entry that could not be a day is dropped (too short, a name that is no pack, a phase that is no number)');
  const hand = days.hand();
  ok(Array.isArray(hand.yavin4) && hand.yavin4[0] === 14_400_000 && hand.yavin4[1] === table.yavin4.phase, `the hail carries each world's length in ms and its phase (${JSON.stringify(hand.yavin4)})`);
  ok(Object.keys(new WorldDays({}).hand()).length === 0 && /game's own/.test(new WorldDays({}).describe()), "with no system applied the hail carries no worlds and the server says every world keeps the game's own day");
  // The server's sum against the browser's, at many moments: one hour.
  const browser = new SharedClock();
  let worst = 0;
  for (let k = 0; k < 500; k++) {
    const now = Date.UTC(2026, 10, 23) + k * 7_919_113.7;
    browser.wall = () => now;
    browser.hail(now);
    for (const w of ['yavin4', 'naboo', 'rori']) {
      const d = days.of(w)!;
      const a = ownDayFraction(now, d);
      const b = browser.ownTimeOfDay(d);
      const c = worldHourAt(d, now) / 24;
      worst = Math.max(worst, Math.abs(a - b), Math.abs(a - c));
    }
  }
  ok(worst === 0, `the server's time of day of each world, the browser's day and the console's are one sum to the bit at 500 moments (worst ${worst})`);
  // The story's hour: the world's own where it keeps one, the game's elsewhere.
  const at = Date.UTC(2026, 10, 23, 7, 30);
  const clock = new WorldClock({ now: () => at });
  const sw = storyWorlds({ clock, days: () => days });
  ok(sw.hourOf('yavin4') === hourOfDay(ownDayFraction(at, days.of('yavin4'))), `the story's hour on Yavin 4 is its own day's (${sw.hourOf('yavin4')})`);
  ok(sw.hourOf('tatooine') === storyWorlds({ clock }).hourOf('tatooine'), "and on Tatooine, which no system holds here, the game's own day's, as before");
  ok(/4 worlds keep their own day/.test(String((sw.describe() as { ownDays?: string }).ownDays)), 'the status says which worlds keep their own day');
  // An admin's change of the game's day moves no world's own.
  const before = sw.hourOf('yavin4');
  clock.setDay(3_600_000);
  ok(sw.hourOf('yavin4') === before && clock.dayMs === 3_600_000, "an admin's change of the game's day length leaves the worlds' own days as they were");
}

if (typeof WebSocket === 'undefined') {
  console.log('     the relay round trip was skipped: this node has no WebSocket of its own');
  console.log(`\nownDays: ${passed} checks passed`);
} else {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'swg-own-days-'));
  const bodies = join(dir, 'bodies.json');
  writeFileSync(bodies, JSON.stringify({ version: 1, made: '', credits: '', looks: {}, uses: {}, systems, air: {}, pictures: {} }));
  // A port of the wave's own (8790 to 8794: never the owner's 8787).
  const port = 8793;
  process.env.PORT = String(port);
  process.argv.push(`--data=${dir}`, `--bodies=${bodies}`);
  await import('../../../server/relay.mjs');
  const shelf = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, String(v)), removeItem: (k: string) => void shelf.delete(k) };
  g.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  const { Net } = await import('../../../src/net/net.ts');
  const { sharedClock } = await import('../../../src/world/sharedClock.ts');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (what: () => boolean, ms = 4000) => {
    for (let t = 0; t < ms && !what(); t += 50) await wait(50);
    return what();
  };
  const browser = (name: string, character: string, planet: string) => {
    const net = new Net();
    net.session.noteCharacter({ id: character, name }, { species: 'human_male', class: 'jedi', planet, zone: '' });
    net.connect(`ws://127.0.0.1:${port}`, { name, species: 'human_male', class: 'jedi', planet });
    return net;
  };
  const a = browser('Mon', 'char-own-days-a', 'yavin4');
  const b = browser('Wedge', 'char-own-days-b', 'yavin4');
  try {
    ok(await until(() => a.session.authority === 'server' && b.session.authority === 'server'), 'a real relay reading the bodies file takes both browsers');
    const t = SERVER_WORLD_DAYS.table;
    ok(!!t && t.yavin4?.lengthSeconds === 14_400 && t.yavin4?.phase === table.yavin4.phase && t.rori?.lengthSeconds === table.rori.lengthSeconds, `its hail told the browser which worlds keep their own day, and each one's day as this browser's file has it (${JSON.stringify(t?.yavin4)})`);
    const status = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { ownDays: { said: string; file: string; hours: Record<string, number> } };
    const browserHour = 24 * sharedClock.ownTimeOfDay(t!.yavin4);
    const serverHour = status.ownDays.hours.yavin4;
    ok(Math.abs(serverHour - browserHour) < 0.01, `the server's status and a browser on its clock put Yavin 4 at one hour (${serverHour} and ${browserHour.toFixed(4)}; ${status.ownDays.said})`);
    ok(status.ownDays.file === bodies, 'and it read the bodies file it was told to (`--bodies`)');
    // The file changed on disk (a Save to game): the relay reads it again within a few seconds and the hail of a new line says so.
    writeFileSync(bodies, JSON.stringify({ version: 1, systems: {} }));
    await wait(5200);
    const after = (await (await fetch(`http://127.0.0.1:${port}/`)).json()) as { ownDays: { said: string; hours: Record<string, number> } };
    ok(Object.keys(after.ownDays.hours).length === 0 && /game's own/.test(after.ownDays.said), `a changed file is read again: with no system applied every world keeps the game's own day (${after.ownDays.said})`);
    takeServerDays({ w: [3_600_000, 0.5], bad: 'x', also: [0, 1] });
    ok(SERVER_WORLD_DAYS.table?.w?.lengthSeconds === 3600 && !SERVER_WORLD_DAYS.table?.bad && !SERVER_WORLD_DAYS.table?.also, "the browser keeps only a hail's days that read as days");
  } finally {
    a.disconnect?.();
    b.disconnect?.();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // the relay may still hold its world file open on Windows; the temp folder goes with the machine's own cleaning
    }
  }
  console.log(`\nownDays: ${passed} checks passed`);
  process.exit(0);
}
