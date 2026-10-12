// Things put down in play are solid: the real streamer and the real physics, driven in node.
//
// A house a player puts down was walked through and fallen through for two passes because the size tier it
// was filed in kept its object list on a copy of the region's (`buildTier`), and the collider sweep walks the
// tier's list. The same fault took collision off every travel terminal, fitting and saved prop stood on
// arrival. This puts houses and crates down the ways the game does and asks the physics itself: a ray down
// through a house's middle meets its roof, and the game's own indoor ray meets its room's floor. It also
// holds the two holes the runtime loop had while a placement was compiling (its tier unloading, and a later
// placement taken away), the per-tier instance count, and the three-way `solid` rule that keeps our seats
// from ever being solid. Nothing is written; only counts are printed.
import assert from 'node:assert/strict';
import { INDOOR_FILTER, ROCK_AT, gatePrepare, makeStreamer, type Harness } from './streamHarness.ts';

// After the harness, never beside it: a static import here would be resolved before the harness has put
// its stub in front of the particle player, and that module will not load under plain node.
const { COLLIDER_MIN_RADIUS, collidesByRule } = await import('../../../src/world/layoutStream.ts');

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number | null, b: number, tol = 0.05): boolean => a !== null && Math.abs(a - b) <= tol;

/** How many colliders the thing filed under `key` has this instant (-1 for none filed). */
const colliders = (h: Harness, key: string): number => h.stream.placedState(key)?.colliders ?? -1;
/** The house's roof is at 8 m and its room's floor at 0.3 m; nothing else in these worlds is under it. */
const ROOF = 8;
const FLOOR = 0.3;

// ---------------------------------------------------------------------------------------------
// 1-5: one world, the rock in region (0,0) and two houses put down in region (1,0), which holds nothing.
{
  const h = await makeStreamer();
  const home = { x: 300, z: 100 };
  await h.settle(home);
  ok(h.rayDown(ROCK_AT.x, ROCK_AT.z, 40) !== null && near(h.rayDown(ROCK_AT.x, ROCK_AT.z, 40), 30), "the world's own rock is solid once its tier has loaded");
  ok(h.s.regions.get('1,0') === undefined, 'and the region the house goes in holds nothing yet');

  // 1. Into a region whose size tier holds nothing: the tier loads for the house alone.
  await h.put('home:A', 'house', home.x, home.z);
  await h.settle(home);
  const state = h.stream.placedState('home:A');
  ok(state !== null && state.tier === 0 && state.tierLoaded, '1: the house files in tier 0, and that tier has loaded for it');
  ok(colliders(h, 'home:A') === 2, `1: once a sweep has run it has a collider for its shell and one for its room (${colliders(h, 'home:A')})`);
  ok(near(h.rayDown(home.x, home.z), ROOF), `1: a ray down through its middle meets its roof (${h.rayDown(home.x, home.z)})`);
  ok(near(h.rayDown(home.x, home.z, 20, INDOOR_FILTER), FLOOR), `1: and the game's own indoor ray passes the shell and meets its room's floor (${h.rayDown(home.x, home.z, 20, INDOOR_FILTER)})`);
  const b = h.stream.buildingOf('home:A');
  ok(b !== null && h.stream.cellsSolid({ building: b, cell: 1 }), '1: a body standing in its room is told its floor is there');
  ok(h.tiersShareLists() > 0, "1: every loaded tier's object list is its region's own array");

  // 2. A second house into that tier, which was built with a placement in it.
  const second = { x: 300, z: 200 };
  await h.put('home:C', 'house', second.x, second.z);
  await h.settle(home);
  ok(colliders(h, 'home:C') === 2 && near(h.rayDown(second.x, second.z), ROOF), '2: a second house into a tier built with a placement in it is solid too');
  ok(colliders(h, 'home:A') === 2, '2: and the first still is');

  // 3. Away past every tier's reach and back: both tiers unload and load again with the houses in them.
  await h.settle({ x: 5000, z: 5000 });
  ok(colliders(h, 'home:A') === 0 && h.rayDown(home.x, home.z) === null, '3: five kilometres off, the house has no collision (its tier has gone)');
  await h.settle(home);
  ok(colliders(h, 'home:A') === 2 && colliders(h, 'home:C') === 2, '3: back again, both houses have their colliders again');
  ok(near(h.rayDown(home.x, home.z), ROOF) && near(h.rayDown(second.x, second.z, 20, INDOOR_FILTER), FLOOR), '3: a ray meets one roof and the indoor ray the other floor');
  ok(near(h.rayDown(ROCK_AT.x, ROCK_AT.z, 40), 30), '3: and the rock beside them is still solid');
  ok(h.tiersShareLists() > 0, "3: every tier loaded again shares its region's list");

  // 4. One house taken up: exactly its meshes and its colliders go.
  const before = h.scene.children.length;
  const rec = h.s.runtime.get(h.s.placedByKey.get('home:A'));
  ok(rec && rec.meshes.length === 2, '4: a house stood in play has meshes of its own (its shell and its floor)');
  ok(h.stream.unplace('home:A'), '4: it can be taken up');
  await h.settle(home);
  ok(before - h.scene.children.length === rec.meshes.length, `4: the scene loses exactly its meshes (${before - h.scene.children.length})`);
  ok(h.meshesAt(home.x, home.z) === 0 && h.stream.placedState('home:A') === null && !h.hasRecord('home:A'), '4: nothing of it is left standing or filed');
  ok(h.rayDown(home.x, home.z) === null, '4: and nothing is under where it stood');
  ok(colliders(h, 'home:C') === 2 && near(h.rayDown(ROCK_AT.x, ROCK_AT.z, 40), 30), '4: the other house and the rock are still solid');

  // 5. Every tier unloaded: the count comes back to nought.
  ok(h.stream.tierReport().loadedInstances > 0, '5: with the player there, the tiers hold instances');
  await h.settle({ x: 9000, z: 9000 });
  ok(h.tiersShareLists() === 0, '5: nine kilometres off, no tier is loaded');
  ok(h.stream.tierReport().loadedInstances === 0, `5: and the instance count is 0 (${h.stream.tierReport().loadedInstances})`);
  ok(h.stream.colliderCount === 0, '5: and no collider is left');

  // 6. The three-way rule, on things the size of a crate (tier 2) in the rock's region.
  ok(COLLIDER_MIN_RADIUS === 1.5, 'the size floor is 1.5 m of radius');
  ok(collidesByRule({ radius: 2 } as never) && !collidesByRule({ radius: 0.4 } as never), '6: absent, the size decides');
  ok(collidesByRule({ radius: 0.4, solid: true } as never) && !collidesByRule({ radius: 2, solid: false } as never), '6: true is solid whatever the size, false never');
}

// 6, in the world: the snapshot's own crate, a seat of ours and a terminal.
{
  const crateAt = { x: 60, z: 60 };
  const h = await makeStreamer([
    { template: 'object/rock', model: 'rock', x: -ROCK_AT.x, y: 0, z: ROCK_AT.z, q: [1, 0, 0, 0], radius: 40 },
    { template: 'object/crate', model: 'crate', x: -crateAt.x, y: 0, z: crateAt.z, q: [1, 0, 0, 0], radius: 2 },
  ]);
  await h.settle(ROCK_AT);
  await h.put('seat:1', 'crate', 70, 60, { radius: 2, solid: false });
  await h.put('travel:1', 'crate', 80, 60, { radius: 0.4, solid: true });
  await h.settle(ROCK_AT);
  ok(h.stream.placedState('seat:1')?.tierLoaded === true && h.stream.placedState('travel:1')?.tierLoaded === true, '6: both stand in a loaded tier');
  ok(colliders(h, 'seat:1') === 0 && h.rayDown(70, 60) === null, '6: a placement with solid false and a radius of 2 is never solid (a seat of ours under a seated person)');
  ok(colliders(h, 'travel:1') === 1 && near(h.rayDown(80, 60), 1), '6: one with solid true and a radius of 0.4 is (a travel terminal)');
  ok(near(h.rayDown(crateAt.x, crateAt.z), 1), "6: and the snapshot's own crate of radius 2, which says nothing, is solid by its size");
  // And the perch's question agrees with the sweep: a seat is never a floor to wait for.
  ok(h.s.floorAsk.collides(h.s.placedByKey.get('seat:1')) === false && h.s.floorAsk.collides(h.s.placedByKey.get('travel:1')) === true, "6: the perch's own idea of what is ever solid is the sweep's");
}

// ---------------------------------------------------------------------------------------------
// 7. The tier unloads while the first of two placements in it is being compiled.
{
  const h = await makeStreamer();
  const gate = gatePrepare(h.stream);
  const far = { x: 20000, z: 20000 };
  const at = { x: 6100, z: 100 };
  await h.settle(far, 2);
  await h.put('home:P', 'house', at.x, at.z);
  await h.put('home:Q', 'house', at.x, at.z + 60);
  ok(h.stream.placedState('home:P')?.tierLoaded === false, '7: two houses put down in a tier that has not loaded');
  gate.arm();
  for (let i = 0; i < 20 && !gate.held; i++) await h.settle(at, 1);
  ok(gate.held, "7: walking in starts the tier's build, which stops in the first house's compile");
  ok(h.stream.placedState('home:P')?.tierLoaded === true, '7: the tier is already recorded as loaded');
  await h.settle({ x: at.x + 5000, z: at.z }, 2);
  ok(h.stream.placedState('home:P')?.tierLoaded === false, '7: five kilometres off, it unloads while the compile still waits');
  gate.open();
  await h.settle({ x: at.x + 5000, z: at.z }, 5);
  ok(h.meshesAt(at.x, at.z) === 0 && h.meshesAt(at.x, at.z + 60) === 0, '7: once the compile ends, no mesh of either house stands in the scene');
  ok(!h.hasRecord('home:P') && !h.hasRecord('home:Q'), '7: and the streamer keeps no record for either');
  ok(h.stream.tierReport().loadedInstances === 0, `7: and the instance count is 0 (${h.stream.tierReport().loadedInstances})`);
  // Walked back in, both are built and solid as if nothing had happened.
  await h.settle(at);
  ok(colliders(h, 'home:P') === 2 && colliders(h, 'home:Q') === 2, '7: walked back in, both are built and solid');
  ok(h.meshesAt(at.x, at.z) === 2 && h.meshesAt(at.x, at.z + 60) === 2, '7: each with its own two meshes, once');
}

// 8. A placement taken away while an earlier one in its tier is being compiled.
{
  const h = await makeStreamer();
  const gate = gatePrepare(h.stream);
  const at = { x: -6100, z: 100 };
  await h.settle({ x: 20000, z: 20000 }, 2);
  await h.put('home:R', 'house', at.x, at.z);
  await h.put('home:S', 'house', at.x, at.z + 60);
  gate.arm();
  for (let i = 0; i < 20 && !gate.held; i++) await h.settle(at, 1);
  ok(gate.held, "8: the tier's build stops in the first house's compile");
  ok(h.stream.unplace('home:S'), '8: the second house is taken away meanwhile');
  gate.open();
  await h.settle(at);
  ok(h.meshesAt(at.x, at.z + 60) === 0 && !h.hasRecord('home:S'), '8: it is never built: no mesh of it stands, and no record keeps one');
  ok(colliders(h, 'home:R') === 2 && h.meshesAt(at.x, at.z) === 2, '8: and the first is built and solid');
  ok(h.stream.tierReport().loadedInstances === 1, `8: the tier holds the one instance (${h.stream.tierReport().loadedInstances})`);
  await h.settle({ x: 20000, z: 20000 }, 2);
  ok(h.stream.tierReport().loadedInstances === 0, '8: and none once it has unloaded');
}

console.log(`\n${passed} checks passed`);
