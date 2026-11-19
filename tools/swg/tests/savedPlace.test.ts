// A character's saved place can no longer keep it out of the world. `__debug.look()` with nothing in it set the camera's
// yaw to undefined, the heading followed it to NaN, `savePlace` wrote it, and JSON writes NaN as null: the next `play`
// read a null heading as "there", and its first save stopped the arrival with `null.toFixed`. Now `mendPlace` in
// src/core/characters.ts mends a record before `play` reads it, `savePlace` never writes a place or a heading that is not
// finite, and `look` takes numbers only. The rule is the game's own function; the three places in main.ts that only the
// running game reaches are held as text.
//
// Everything here is synthetic. Run: node tools/swg/tests/savedPlace.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mendPlace } from '../../../src/core/characters.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 1. the rule, on records as storage hands them back
{
  // The save that broke it, as it came back out of storage.
  const broken = JSON.parse(JSON.stringify({ id: 'a', pos: [3528.1, 4.2, -4804.5], heading: Number.NaN }));
  ok(broken.heading === null, 'JSON hands a NaN heading back as null (the fault this mends)');
  ok(mendPlace(broken) === true, 'a null heading is mended');
  ok(broken.heading === 0, 'and faces north');
  ok(broken.pos.join() === '3528.1,4.2,-4804.5', 'a good place beside it is left exactly as it was');

  const posGone = JSON.parse(JSON.stringify({ pos: [Number.NaN, 4, 5], heading: 1.25 }));
  ok(mendPlace(posGone) === true && !('pos' in posGone), 'a place with a null in it is taken off, so the world\'s arrival point is used');
  ok(posGone.heading === 1.25, 'and a good heading beside it is kept');

  for (const bad of [[1, 2], [1, 2, 3, 4], 'x', { x: 1 }, [1, '2', 3], [1, Infinity, 3], null]) {
    const r: { pos?: unknown; heading?: unknown } = { pos: bad, heading: 0.5 };
    ok(mendPlace(r) === true && !('pos' in r), `a place of ${JSON.stringify(bad)} is taken off`);
  }
  for (const bad of [null, 'north', Infinity, -Infinity, Number.NaN, {}]) {
    const r: { pos?: unknown; heading?: unknown } = { heading: bad };
    ok(mendPlace(r) === true && r.heading === 0, `a heading of ${String(bad)} becomes 0`);
  }

  const good = { pos: [1, 2, 3] as [number, number, number], heading: -3.1 };
  ok(mendPlace(good) === false && good.pos.join() === '1,2,3' && good.heading === -3.1, 'a sound record is left alone and reported unchanged');
  const fresh: { pos?: unknown; heading?: unknown } = {};
  ok(mendPlace(fresh) === false && !('pos' in fresh) && !('heading' in fresh), 'a new character with no place yet is left alone (nothing is added)');
}

// ---------------------------------------------------------------- 2. the game's three places, as text
{
  const play = main.slice(main.indexOf('  private async play(c: SavedCharacter)'));
  const firstRead = Math.min(...['c.pos', 'c.heading'].map((w) => play.indexOf(w)).filter((i) => i >= 0));
  const mend = play.indexOf('if (mendPlace(c)) upsertCharacter(c);');
  ok(mend > 0 && mend < firstRead, 'play mends the record, and writes it back, before anything reads its place or heading');

  const save = main.slice(main.indexOf('  private savePlace(now = false): void {'));
  const saveBody = save.slice(0, save.indexOf('\n  }\n'));
  ok(!/c\.heading = Number\([^;]*toFixed/.test(saveBody.replace(/if \(Number\.isFinite\([^)]*\)\) c\.heading = /g, '')), 'savePlace writes no heading except under a finite test');
  ok(/if \(Number\.isFinite\(heading\)\) c\.heading = Number\(heading\.toFixed\(3\)\);/.test(saveBody), 'the place on this world: its heading only when finite');
  ok(/if \(Number\.isFinite\(p\.heading\)\) c\.heading = Number\(p\.heading\.toFixed\(3\)\);/.test(saveBody), 'the place kept on another world: its heading only when finite');
  ok(/if \(Number\.isFinite\(at\.x\) && Number\.isFinite\(at\.y\) && Number\.isFinite\(at\.z\)\) c\.pos = /.test(saveBody), 'the place itself only when all three numbers are finite');

  const look = main.slice(main.indexOf('      look: (yaw: number, pitch?: number) => {'));
  const lookBody = look.slice(0, look.indexOf('\n      },'));
  ok(lookBody.length > 0 && lookBody.indexOf('Number.isFinite(yaw)') >= 0 && lookBody.indexOf('return ') < lookBody.indexOf('this.cam.yaw = yaw'), "look refuses anything but a finite yaw before it sets one");
  ok(/pitch !== undefined && \(typeof pitch !== 'number' \|\| !Number\.isFinite\(pitch\)\)/.test(lookBody) && /if \(pitch !== undefined\) this\.cam\.pitch = pitch;/.test(lookBody), 'and a pitch, which may be left off and then stays as it was');
}

console.log(`\nsavedPlace: ${checks} checks passed`);
