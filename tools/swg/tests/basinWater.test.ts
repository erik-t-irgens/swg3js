// The water in a fountain's basin, as the feet, the ripple field and the spray ask about it: which
// points are over it, how high it stands, and which level the ripple field takes near it.
//
// The basins are built by hand here -- a round one as a fan of triangles, and a square one with a wall
// hanging off it -- so every rule is pinned whatever machine runs this.
//
// Run: node tools/swg/tests/basinWater.test.ts

import assert from 'node:assert/strict';
import { BASIN_WATER_TUNE, basinFootprint, basinLevelNear, basinLook, basinTopAt, overBasin } from '../../../src/world/basinWater.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) < eps;

/** A column-major 4x4 that moves by (x, y, z) and turns `yaw` about up. */
function placed(x: number, y: number, z: number, yaw = 0): number[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1];
}

/** A round basin of radius r at height h in its own frame: a fan of `n` triangles about the middle. */
function round(r: number, h: number, n = 24): { positions: number[]; index: number[] } {
  const positions = [0, h, 0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    positions.push(Math.cos(a) * r, h, Math.sin(a) * r);
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) index.push(0, 1 + ((i + 1) % n), 1 + i);
  return { positions, index };
}

{
  const { positions, index } = round(2, 0.6);
  const b = basinFootprint(positions, index, placed(100, 5, -40))!;
  ok(!!b && near(b.top, 5.6), 'a basin stands where its copy is placed, at its own surface height (5 + 0.6)');
  ok(overBasin(b, 100, -40) && overBasin(b, 101.5, -40) && overBasin(b, 100, -41.9), 'a point inside the round rim is over the water');
  ok(!overBasin(b, 101.6, -38.4), "and a point in the box's corner, off the rim, is not -- a box would have had somebody on the paving wading");
  ok(!overBasin(b, 103, -40), 'nor is one past the rim');
  ok(near(basinTopAt([b], 100, -40, 5.2), 5.6), 'somebody standing in it has the water at the surface over them');
  ok(near(basinTopAt([b], 100, -40, 6.5), 5.6), 'and so does somebody standing on it, which is what a ripple needs to know');
  ok(basinTopAt([b], 100, -40, 5.6 + BASIN_WATER_TUNE.reachUp + 1) === -Infinity, 'a balcony well above a fountain is not in it');
  ok(near(basinTopAt([b], 100, -40), 5.6), 'asked by column alone (a droplet falling back), the height is the surface whatever the height asked from');
  ok(basinTopAt([b], 0, 0, 5) === -Infinity, 'and far away there is no basin water at all');
}

{
  // Turned a quarter: the footprint turns with the copy.
  const positions = [-3, 0, -0.5, 3, 0, -0.5, 3, 0, 0.5, -3, 0, 0.5];
  const index = [0, 2, 1, 0, 3, 2];
  const b = basinFootprint(positions, index, placed(0, 1, 0, Math.PI / 2))!;
  ok(overBasin(b, 0, 2.5) && !overBasin(b, 2.5, 0), 'a long trough turned a quarter lies along the other axis');
}

{
  // A basin piece with a wall on it: only the level part is the surface.
  const positions = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, /* wall */ -1, 0, -1, 1, 0, -1, 1, 2, -1];
  const index = [0, 2, 1, 0, 3, 2, 4, 5, 6];
  const b = basinFootprint(positions, index, placed(0, 0, 0))!;
  ok(near(b.top, 0), "a piece's wall does not lift its surface: only the level triangles are the water");
  ok(basinFootprint([0, 0, 0, 1, 0, 0, 1, 2, 0], null, placed(0, 0, 0)) === null, 'and a piece with no level triangle is no basin at all');
  const unindexed = basinFootprint([-1, 0, -1, 1, 0, 1, 1, 0, -1], null, placed(0, 0, 0));
  ok(!!unindexed && overBasin(unindexed, 0.5, -0.5), 'a piece with no index is read as plain triangles, either winding');
}

{
  const low = basinFootprint(round(1, 0).positions, round(1, 0).index, placed(0, 0, 0))!;
  const high = basinFootprint(round(1, 0).positions, round(1, 0).index, placed(0, 3, 0))!;
  ok(near(basinTopAt([low, high], 0, 0, 2.5), 3), 'where two basins stand one over the other (a tiered fountain), the higher answers');
  const far = basinFootprint(round(1, 0).positions, round(1, 0).index, placed(30, 7, 0))!;
  ok(near(basinLevelNear([low, far], 4, 0), 0), 'the ripple field takes the level of the basin the player is beside');
  ok(near(basinLevelNear([low, far], 27, 0), 7), 'and of the nearer one when there are two');
  ok(Number.isNaN(basinLevelNear([low, far], 15, 0)), 'and none at all out in the square between them, which leaves the planet its own');
}

{
  const look = basinLook();
  ok(look.color === BASIN_WATER_TUNE.color && look.opacity === BASIN_WATER_TUNE.opacity && look.cube === null, "a basin wears the table's own look, and no cube of any shader's");
  BASIN_WATER_TUNE.opacity = 0.3;
  ok(basinLook().opacity === 0.3, 'and a change to the table is what the next look is made of, which is how the console restyles every basin');
  BASIN_WATER_TUNE.opacity = look.opacity;
}

console.log(`\nbasin water: ${passed} checks passed`);
