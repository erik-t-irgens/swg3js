// The water's depth window over a submerged roof (Map-maker II's fifth wave, DESIGN.md §2.7's "a roof under the surface"):
// the window's height callback answers the higher of the ground and the top of a building with rooms standing under a lake
// of ours, inside that building's own turned box, and the ground everywhere else; with no roof (no water file, or no
// building under a lake) it hands back the very ground it was handed, by `Object.is`. And the world wires it so: one kept
// callback for both of the window's readers, the roofs made again only while there is a lake of ours.
//
// Run: node tools/swg/tests/roofDepth.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { LAKE_TUNE, RoofList } from '../../../src/world/ourWater.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

{
  const roofs = new RoofList();
  // With no roof the ground handed in comes back itself, every value (NaN and -0 among them).
  let same = true;
  for (const g of [0, -0, 12.5, -300, Number.NaN, 1e-9]) if (!Object.is(roofs.topAt(10, 20, g), g)) same = false;
  ok(same, 'with no roof the window reads the ground it was handed, by Object.is');
  // A building's box 20 m by 10 m, turned 30 degrees, its top at 5 m under a lake.
  const a = (30 * Math.PI) / 180;
  roofs.add(100, 50, 10, 5, Math.cos(a), Math.sin(a), 5);
  ok(roofs.count === 1, 'a roof kept');
  // Inside the box (along its turned axes) the roof's top over a lower ground; the ground where it stands higher.
  const along = (u: number, v: number): [number, number] => [100 + u * Math.cos(a) - v * Math.sin(a), 50 + u * Math.sin(a) + v * Math.cos(a)];
  const [ix, iz] = along(8, 4);
  ok(roofs.topAt(ix, iz, -10) === 5, 'inside its turned box the window reads the roof\'s top over the bed');
  ok(roofs.topAt(ix, iz, 7) === 7, 'and the ground where the ground stands higher');
  const [ox, oz] = along(11, 0);
  const [oz2x, oz2z] = along(0, 6);
  ok(roofs.topAt(ox, oz, -10) === -10 && roofs.topAt(oz2x, oz2z, -10) === -10, 'just outside it, along either axis, the ground');
  // A box turned the other way: the turn is three's own sense, the matrix's first column on the ground.
  const [bx, bz] = along(-9, -4);
  ok(roofs.topAt(bx, bz, -10) === 5, 'its far corner too');
  roofs.clear();
  ok(roofs.count === 0 && Object.is(roofs.topAt(ix, iz, -10), -10), 'cleared, the ground again (the records kept for the next)');
  roofs.add(0, 0, 1, 1, 1, 0, 3);
  ok(roofs.list.length === 1, 'and a roof added again takes the kept record');
}

{
  // A building's own roof (`RoofList.addBuilding`, what `World.refreshRoofs` asks of every building standing): its model's
  // box (off its origin, its corners in either order) through its matrix, built here by three itself, turned by an angle
  // that is no quarter, so a turn the wrong way round, a middle left at the origin or a box taken unturned all fail.
  const roofs = new RoofList();
  const b = new THREE.Object3D();
  b.position.set(250, 4, -130);
  b.rotation.y = 0.7;
  b.updateMatrixWorld(true);
  const e = b.matrixWorld.elements;
  // Its box in its own frame, 6 to 22 m along x and -3 to 9 m along z, 0 to 7 m up, given max first (the BOX lesson).
  const box = { min: [22, 7, 9], max: [6, 0, -3] };
  ok(!roofs.addBuilding(e, box, 4 + 7) && roofs.count === 0, 'a building whose top stands at the surface is no roof under water');
  ok(roofs.addBuilding(e, box, 30) && roofs.count === 1 && roofs.list[0].top === 11, 'one whose top (its origin and its box\'s top, 11 m) stands under the surface is a roof');
  const at = (lx: number, lz: number): [number, number] => {
    const p = new THREE.Vector3(lx, 0, lz).applyMatrix4(b.matrixWorld);
    return [p.x, p.z];
  };
  let inside = 0;
  let wrong = 0;
  for (const [lx, lz] of [[7, -2], [21, 8], [14, 3], [6.5, 8.5], [21.5, -2.5]] as const) {
    const [x, z] = at(lx, lz);
    inside++;
    if (roofs.topAt(x, z, -50) !== 11) wrong++;
  }
  ok(wrong === 0, `every point inside its box, read through three's own turn of it, reads the roof's top (${inside} points, the corners among them)`);
  let outside = 0;
  for (const [lx, lz] of [[5.5, 3], [22.5, 3], [14, -3.5], [14, 9.5], [0, 0], [-14, -3]] as const) {
    const [x, z] = at(lx, lz);
    if (roofs.topAt(x, z, -50) !== -50) outside++;
  }
  ok(outside === 0, 'just outside it along each of its own axes, at its origin and at its mirror, the ground');
}

{
  const world = readFileSync(join(REPO, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/private readonly depthHeightAt = \(x: number, z: number\): number \| null => \{\s*const h = this\.terrain\.heightIfCached\(x, z, FAR_TILE, FAR_RES\);\s*if \(h === null \|\| !this\.roofs\.count \|\| !LAKE_TUNE\.roofDepth\) return h;\s*return this\.roofs\.topAt\(x, z, h\);\s*\};/.test(world), "the world's depth callback is the cached ground, raised to a roof only while there is one and the switch is on (`LAKE_TUNE.roofDepth`)");
  ok(/updateWaterDepth\(playerPos\.x, playerPos\.z, this\.depthHeightAt\);/.test(world) && /refreshWaterDepth\(s\.x0, s\.z0, s\.x1, s\.z1, this\.depthHeightAt\);/.test(world), 'one kept callback for both of the window\'s readers (no closure a frame)');
  ok(/if \(this\.ourLakeRows\.length\) this\.stepRoofs\(dt\);/.test(world), 'the roofs are made again only while the world has a lake of ours');
  ok(/for \(const t of tables\) if \(t\.height > surface && tableCovers\(t, e\[12\], e\[14\]\)\) surface = t\.height;\s*(\/\/[^\n]*\n\s*)*this\.roofs\.addBuilding\(e, box, surface\);/.test(world), "every building standing is asked as a roof by its own matrix and the surface over its origin (`RoofList.addBuilding`, held above against three's)");
  ok(LAKE_TUNE.roofDepth === true, 'the switch ships on');
}

console.log(`roofDepth: ${checks} checks passed`);
