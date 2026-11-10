// Falling out of the world asks the ground under the point as well as the world's floor (`src/world/fellOut.ts`), so a
// sinkhole sculpted deeper than the floor is ground. Run with `node tools/swg/tests/fellOut.test.ts`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fellOut, FELL_UNDER } from '../../../src/world/fellOut.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
};

// A flat world at 0 m: floor -30, as Terrain makes it (minH - 30).
const flat = (g: (x: number, z: number) => number) => ({ floor: -30, heightAt: g });

// 1. Wherever the ground stands at least FELL_UNDER over the floor, the answer is the old floor test's, at every margin.
{
  const t = flat(() => 0);
  for (const margin of [0, 20]) {
    for (let y = -200; y <= 10; y += 0.25) {
      ok(fellOut(t, 3, 4, y, margin) === y < t.floor - margin, `unsculpted ground: the old answer at y ${y}, margin ${margin}`);
    }
  }
  const high = flat(() => 412.5);
  for (let y = -200; y <= 10; y += 0.5) ok(fellOut(high, 0, 0, y) === y < high.floor, `raised ground: the old answer at y ${y}`);
}

// 2. A sinkhole sculpted to -300 m on that world: standing on its floor or anywhere down its walls is not falling out.
{
  const hole = (x: number, z: number): number => (Math.hypot(x, z) < 50 ? -300 : 0);
  const t = flat(hole);
  for (let y = -300; y <= 0; y += 1) ok(!fellOut(t, 10, 10, y), `in the sinkhole at y ${y}`);
  ok(!fellOut(t, 10, 10, -300 - FELL_UNDER + 0.01), 'just over the catch under the sinkhole');
  ok(fellOut(t, 10, 10, -300 - FELL_UNDER - 0.01), 'fallen through the sinkhole floor: caught');
  ok(fellOut(t, 10, 10, -300 - FELL_UNDER - 20.01, 20), 'a creature fallen through it: caught with its margin');
  ok(!fellOut(t, 10, 10, -300 - FELL_UNDER - 19.99, 20), 'a creature just over its margin');
  ok(fellOut(t, 200, 0, -31), 'outside the sinkhole the floor is the floor');
}

// 3. Ground that reads NaN, and a stand-in with no ground, keep the floor alone.
{
  ok(fellOut({ floor: -30, heightAt: () => NaN }, 0, 0, -31), 'NaN ground: the floor alone');
  ok(!fellOut({ floor: -30, heightAt: () => NaN }, 0, 0, -29), 'NaN ground over the floor: not out');
  ok(fellOut({ floor: -30 }, 0, 0, -30.5), 'no heightAt: the floor alone');
  ok(!fellOut({ floor: -30 }, 0, 0, -29.5), 'no heightAt over the floor: not out');
}

// 4. The ground is read only once the floor has been passed.
{
  let reads = 0;
  const t = { floor: -30, heightAt: (): number => (reads++, 0) };
  for (let y = -29; y < 100; y++) fellOut(t, 0, 0, y);
  ok(reads === 0, 'no ground read over the floor');
  fellOut(t, 0, 0, -40);
  ok(reads === 1, 'one ground read under it');
}

// 5. The three places that catch a fall ask it: the player with the ground it already has, the creatures and the people.
{
  const src = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
  ok(src('src/player/player.ts').includes('this.pos.y < terrain.floor && !(this.pos.y >= ground - FELL_UNDER)'), 'the player asks the ground under it');
  ok(src('src/world/creatures.ts').includes('fellOut(this.terrain, c.pos.x, c.pos.z, c.pos.y, 20)'), 'the creatures ask fellOut');
  ok(src('src/world/mobiles/manager.ts').includes('fellOut(this.deps.terrain, m.pos.x, m.pos.z, m.pos.y, 20)'), 'the people ask fellOut');
  for (const f of ['src/player/player.ts', 'src/world/creatures.ts', 'src/world/mobiles/manager.ts']) {
    ok(!/pos\.y < (this\.)?(deps\.)?terrain\.floor - 20/.test(src(f)), `${f}: no bare floor test left`);
  }
}

console.log(`fellOut: ${checks} checks passed`);
