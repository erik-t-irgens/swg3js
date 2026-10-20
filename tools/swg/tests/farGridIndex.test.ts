// The terrain's far grids found by number (src/world/farGridIndex.ts, the performance pass's sixth wave's fix round):
// over a random run of grids filed, taken out and looked up -- the corners on one world's lattice, a few off it, a few
// out of its reach, two tilings -- the index answers exactly what the string-keyed map the terrain keeps answers, or
// says it cannot (undefined) and the string key does; two corners in one cell never answer for each other; and a
// lookup makes nothing (young generation measured, as the perf test does).
//
// Synthetic: numbers made up here, nothing read from the game's files.
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { FarGridIndex } from '../../../src/world/farGridIndex.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const key = (gx0: number, gz0: number, size: number, res: number): string => `f:${gx0},${gz0},${size},${res}`;

// ---- The index against the string map over a random run. ----
{
  const idx = new FarGridIndex<{ id: number }>();
  const map = new Map<string, { id: number }>();
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const SHIFT = 1;
  // The big tiling's corners all on the world's lattice (a multiple of the size plus its shift) or past the index's
  // reach; the small one's some off the lattice too, which makes that tiling answer by string key from then on.
  const corner = (size: number): [number, number] => {
    const r = rand();
    if (r < 0.85) return [(Math.floor(rand() * 64) - 32) * size + SHIFT, (Math.floor(rand() * 64) - 32) * size + SHIFT];
    if (r < 0.95 && size === 64) return [Math.round((rand() - 0.5) * 2000), Math.round((rand() - 0.5) * 2000)];
    return [(Math.floor(rand() * 4000) + 2000) * size, 0];
  };
  let wrong = 0;
  let byNumber = 0;
  let byString = 0;
  let id = 0;
  for (let k = 0; k < 20000; k++) {
    const size = rand() < 0.8 ? 512 : 64;
    const res = size === 512 ? 32 : 16;
    const [gx0, gz0] = corner(size);
    const op = rand();
    if (op < 0.35) {
      const g = { id: id++ };
      map.set(key(gx0, gz0, size, res), g);
      idx.set(gx0, gz0, size, res, g);
    } else if (op < 0.5) {
      map.delete(key(gx0, gz0, size, res));
      idx.delete(gx0, gz0, size, res);
    } else {
      const want = map.get(key(gx0, gz0, size, res)) ?? null;
      const n = idx.get(gx0, gz0, size, res);
      const got = n !== undefined ? n : (map.get(key(gx0, gz0, size, res)) ?? null);
      if (n !== undefined) byNumber++;
      else byString++;
      if (got !== want) wrong++;
    }
  }
  ok(wrong === 0, `over 20,000 grids filed, taken out and looked up the index answers what the string map answers (${byNumber} by number, ${byString} by string key, ${wrong} wrong)`);
  ok(byNumber > byString * 2, 'and most lookups are answered by number (the string key only off the lattice and out of reach)');
  idx.clear();
  ok(idx.size === 0 && idx.get(SHIFT, SHIFT, 512, 32) === null, 'cleared, it holds nothing');
}

// ---- Two corners in one cell never answer for each other. ----
{
  const idx = new FarGridIndex<string>();
  idx.set(1, 1, 512, 32, 'a');
  ok(idx.get(1, 1, 512, 32) === 'a' && idx.get(3, 1, 512, 32) === undefined && idx.get(513, 1, 512, 32) === null, "a corner on the lattice answers itself; one beside it in the same cell is never answered with the other's grid (undefined: the string key), and an empty cell answers null");
  idx.set(3, 1, 512, 32, 'b');
  ok(idx.get(1, 1, 512, 32) === undefined && idx.get(3, 1, 512, 32) === undefined, 'once two corners have met in one cell, the tiling answers nothing and the string key is asked');
  ok(idx.get(1, 1, 1.5, 32) === undefined && idx.get(1e9, 1, 512, 32) === undefined && idx.files(1, 1, 512, 32) && !idx.files(1e9, 1, 512, 32), 'a tiling that is not whole and a corner out of reach are not filed (undefined: the string key)');
}

// ---- A lookup makes nothing. ----
{
  const gc = (globalThis as { gc?: (o?: { type?: string }) => void }).gc;
  if (gc) {
    const idx = new FarGridIndex<{ heights: Float32Array }>();
    for (let i = -8; i < 8; i++) for (let j = -8; j < 8; j++) idx.set(i * 512 + 1, j * 512 + 1, 512, 32, { heights: new Float32Array(35 * 35) });
    let found = 0;
    const look = (n: number): void => {
      for (let k = 0; k < n; k++) {
        const i = (k % 16) - 8;
        const j = ((k >> 4) % 16) - 8;
        if (idx.get(i * 512 + 1, j * 512 + 1, 512, 32)) found++;
      }
    };
    const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    let best = Infinity;
    for (let attempt = 0; attempt < 4; attempt++) {
      look(200000);
      gc({ type: 'minor' });
      const before = young();
      look(200000);
      const after = young();
      best = Math.min(best, (after - before) / 200000);
    }
    ok(best < 0.05 && found > 0, `a lookup by number makes nothing (${best.toFixed(4)} bytes a lookup)`);
  } else console.log('skip nothing allocated by a lookup: run with node --expose-gc to measure');
}

console.log(`\n${checks} checks passed`);
