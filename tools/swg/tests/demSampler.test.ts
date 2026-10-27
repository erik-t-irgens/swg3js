// The real-elevation rasters' axes, pinned (Map-maker II's groundwork, DESIGN.md §3, W0; the owner's handoff, part 1.6): a
// north-up raster holds its northernmost row first, and north is -Z, so row 0 stands at the -Z edge and `v` runs with z;
// column 0 at the -X edge and `u` runs with x. Over a synthetic 3 x 3 raster with a distinct value a sample, through
// `makeDemPatch` itself: each corner, each edge's middle and the middle read their own sample, and a point between two reads
// their mean. Mirrored either way, a patch looks perfectly plausible and is wrong.
//
// Run: node tools/swg/tests/demSampler.test.ts
import assert from 'node:assert/strict';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// Row by row, top-down as base16.raw holds them: the row a sample is in times 3, plus its column, times 1,000.
const raw = new Uint16Array([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
// A span of 65,535 m over 0: a raw value is its height in metres exactly.
const patch = makeDemPatch(raw.buffer, { mapWidthInMeters: 20, base: { samples: 3, metresPerSample: 10, minHeight: 0, maxHeight: 65535 } }, { size: 20, feather: 0 });
const at = (x: number, z: number) => patch.heightAt(x, z, () => Number.NaN);
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-6;

ok(near(at(-10, -10), 0), 'row 0, column 0 stands at the -X, -Z corner');
ok(near(at(10, -10), 2000), 'row 0, column 2 at the +X, -Z corner (columns run with x)');
ok(near(at(-10, 10), 6000), 'row 2, column 0 at the -X, +Z corner (rows run with z: north is -Z)');
ok(near(at(10, 10), 8000), 'row 2, column 2 at the +X, +Z corner');
ok(near(at(0, 0), 4000), 'the middle sample at the middle');
ok(near(at(0, -10), 1000) && near(at(0, 10), 7000) && near(at(-10, 0), 3000) && near(at(10, 0), 5000), "each edge's middle reads its own sample");
ok(near(at(-5, -10), 500) && near(at(-10, -5), 1500), 'between two samples, their mean (along x by one, along z by three)');
ok(at(10.01, 0) === null && at(0, -10.01) === null, 'outside the square, nothing');

console.log(`\ndemSampler: ${checks} checks passed`);
