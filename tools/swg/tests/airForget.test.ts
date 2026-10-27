// Map-maker II's groundwork (DESIGN.md §3, W0): the moving air's ground raster forgets a game-frame rectangle (the ground
// under it was sculpted, painted or flooded) and its own budgeted fill asks those cells of the world again, every other
// cell's bytes untouched; `clear` is as it was. On the real `AirRaster` with a stand-in ground whose answers change under
// the rectangle between the fills, so a refill is seen to read the new ground and a cell outside to keep the old.
//
// Run: node tools/swg/tests/airForget.test.ts
import assert from 'node:assert/strict';
import { AirRaster, type GroundSample, type GroundSampler } from '../../../src/world/volumetrics/airRaster.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const N = 48;
const CELL = 4;
const OX = -96;
const OZ = -96;
let lift = 0;
const ground: GroundSampler = {
  sample(x: number, z: number, out: GroundSample): boolean {
    out.h = 10 + x * 0.1 + z * 0.05 + (Math.abs(x) < 20 && Math.abs(z) < 12 ? lift : 0);
    out.family = (Math.floor(x / 16) & 3) + 1;
    out.medium = 1;
    out.tint = 0x806040;
    return true;
  },
};
const r = new AirRaster();
r.familyResponse = new Uint8Array(8 * 4).fill(100);
r.familyColour = new Uint8Array(8 * 4).fill(150);
r.familyClass = new Uint8Array(8).fill(1);
r.resize(N);
r.fillAll(ground, OX, OZ, CELL);
ok(r.unknown === 0, 'the raster filled whole');
const snap = () => ({ height: r.height.slice(), response: r.response.slice(), colour: r.colour.slice(), tint: r.tint.slice(), known: r.known.slice(), fam: r.fam.slice(), klass: r.klass.slice() });
const before = snap();
// The ground under the rectangle rises; the raster still holds the old heights until it forgets them.
lift = 7;
const forgot = r.forget(-20, -12, 20, 12);
const inside = (k: number) => {
  const i = k % N;
  const j = Math.floor(k / N);
  return Math.floor((-20 - OX) / CELL) <= i && i <= Math.floor((20 - OX) / CELL) && Math.floor((-12 - OZ) / CELL) <= j && j <= Math.floor((12 - OZ) / CELL);
};
let expected = 0;
for (let k = 0; k < N * N; k++) if (inside(k)) expected++;
ok(forgot === expected && r.unknown === expected && r.dirty, `forget marks exactly the rectangle's cells unknown (${forgot}), and the raster dirty`);
const mid = snap();
let outsideSame = true;
let insideForgot = true;
for (let k = 0; k < N * N; k++) {
  if (inside(k)) {
    if (mid.known[k] !== 0 || mid.colour[k * 4 + 3] !== 0 || mid.klass[k] !== 0) insideForgot = false;
    continue;
  }
  if (mid.height[k] !== before.height[k] || mid.known[k] !== before.known[k] || mid.fam[k] !== before.fam[k] || mid.klass[k] !== before.klass[k]) outsideSame = false;
  for (let c = 0; c < 4; c++) if (mid.response[k * 4 + c] !== before.response[k * 4 + c] || mid.colour[k * 4 + c] !== before.colour[k * 4 + c] || mid.tint[k * 4 + c] !== before.tint[k * 4 + c]) outsideSame = false;
}
ok(insideForgot, "every forgotten cell reads unknown (its medium byte nought, no class)");
ok(outsideSame, "every other cell's bytes are as they were");
// Its own budgeted fill asks them again (a frame's fill with no move: dx and dz nought), within its budget.
for (let i = 0; i < 40 && r.unknown > 0; i++) r.fill(ground, OX, OZ, CELL, 0, 0, 2, 50, () => performance.now());
const after = snap();
let refilled = true;
let outsideStill = true;
for (let k = 0; k < N * N; k++) {
  const i = k % N;
  const j = Math.floor(k / N);
  const x = OX + (i + 0.5) * CELL;
  const z = OZ + (j + 0.5) * CELL;
  if (inside(k)) {
    const s: GroundSample = { h: 0, family: 0, medium: 0, tint: 0, flowX: 0, flowZ: 0 };
    ground.sample(x, z, s);
    if (after.known[k] !== 1 || Math.abs(after.height[k] - Math.fround(s.h)) > 1e-4) refilled = false;
  } else if (after.height[k] !== before.height[k]) outsideStill = false;
}
ok(r.unknown === 0 && refilled, 'its own fill asks every forgotten cell of the world again and reads the ground as it is now');
ok(outsideStill, 'and a cell outside keeps the height it read before (it was never asked again)');
// A rectangle outside the window forgets nothing; clear is as it was.
ok(r.forget(5000, 5000, 5100, 5100) === 0, 'a rectangle the window does not hold forgets nothing');
r.clear();
ok(r.unknown === N * N && r.known.every((v) => v === 0), 'clear still forgets every cell');

console.log(`\nairForget: ${checks} checks passed`);
