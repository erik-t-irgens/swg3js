// What stands on the ground as the sculpt brush keeps off it or carries it (Map-maker II, DESIGN.md §2.4,
// `LayoutStreamer.forEachStandingFoot`), on the real streamer over packs made up on the spot (`streamHarness.ts`). The walk
// visits a snapshot tree (which the air's `forEachSolidBox` steps over: a canopy's box is no wall) by its trunk -- its own
// collision part's reach -- a small prop the size rule gives no collision by its box, the world's rock by its box, a building
// of ours (a permanent row with rooms) and a player's house by box, and a permanent prop as one to carry; each with whose it
// is.
//
// Run: node tools/swg/tests/standingFoot.test.ts
import assert from 'node:assert/strict';
import { makeStreamer, loadedOf, boxGeo, THREE, ROCK_AT } from './streamHarness.ts';
import type { SolidBox, StandingFoot } from '../../../src/world/layoutStream.ts';
import { FLORA_COLLISION, trunkRadius } from '../../../src/world/floraCollision.ts';
import { radiusOfBounds } from '../../../src/story/placements.ts';
// The streamer's module only after the harness has stood its stub in (a static import would load it first).
const { standingFoot } = await import('../../../src/world/layoutStream.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A tree the world files as flora, with the client's own trunk (a cylinder 0.6 m across the planting's foot), and a pebble.
const TREE = { id: 'tree', file: 'tree.glb', bounds: { min: [-4, 0, -4], max: [4, 12, 4] }, triangles: 12, collision: { kind: 'cylinder', shapes: [{ t: 'cyl', c: [0, 0, 0], r: 0.6, h: 7 }] } };
const PEBBLE = { id: 'pebble', file: 'pebble.glb', bounds: { min: [-0.2, 0, -0.3], max: [0.2, 0.25, 0.3] }, triangles: 12 };
// A walk-through tree (a living wroshyr: a NULL extent, the client's own word that it is walked through): kept off by `trunkRadius`.
const WROSHYR = { id: 'wroshyr', file: 'wroshyr.glb', bounds: { min: [-10, 0, -10], max: [10, 40, 10] }, triangles: 12, collision: { kind: 'null', shapes: [] } };
const h = await makeStreamer(
  [
    { template: 'object/rock', model: 'rock', x: -ROCK_AT.x, y: 0, z: ROCK_AT.z, q: [1, 0, 0, 0], radius: 40 },
    { template: 'object/tree', model: 'tree', x: -60, y: 0, z: 70, q: [1, 0, 0, 0], radius: 8 },
    { template: 'object/pebble', model: 'pebble', x: -80, y: 0, z: 120, q: [0.9238795, 0, 0.3826834, 0], radius: 0.35 },
    { template: 'object/wroshyr', model: 'wroshyr', x: -150, y: 0, z: 70, q: [1, 0, 0, 0], radius: 14 },
    // Of a world state this arrival does not stand in (Restuss's living city while the ruins stand): it lies dormant.
    { template: 'object/living_hall', model: 'rock', x: -170, y: 0, z: 160, q: [1, 0, 0, 0], radius: 40, state: 'restuss=living' },
  ],
  {
    defs: [TREE as never, PEBBLE, WROSHYR as never],
    models: { tree: loadedOf(TREE as never, [{ geometry: boxGeo(8, 12, 8, 0), cell: -1 }]), pebble: loadedOf(PEBBLE, [{ geometry: boxGeo(0.4, 0.25, 0.6, 0), cell: -1 }]), wroshyr: loadedOf(WROSHYR as never, [{ geometry: boxGeo(20, 40, 20, 0), cell: -1 }]) },
    flora: ['tree', 'wroshyr'],
    stands: (tag) => tag !== 'restuss=living',
  },
);
await h.settle({ x: 90, z: 100 });
// A building of ours (a permanent row with rooms), a permanent prop, and a player's house.
await h.stream.place({ model: 'hall', template: 'place/hall-1', x: 130, y: 0, z: 60, q: new THREE.Quaternion(), radius: 10, solid: true } as never);
await h.put('place/crate-1', 'crate', 110, 140);
await h.put('home:7', 'house', 40, 140);
await h.settle({ x: 90, z: 100 });

const seen = new Map<string, StandingFoot>();
const foot = standingFoot();
h.stream.forEachStandingFoot(0, 0, 200, 200, foot, (f) => {
  seen.set(f.template, { ...f });
  return true;
});
const tree = seen.get('object/tree');
ok(!!tree && tree.kind === 'trunk' && tree.owner === 'game' && Math.abs(tree.r - 0.6) < 1e-6 && Math.abs(tree.x - 60) < 1e-6, `a snapshot tree is visited by its trunk, its own collision part's reach (${tree?.r.toFixed(2)} m), the game's`);
const pebble = seen.get('object/pebble');
ok(!!pebble && pebble.kind === 'box' && pebble.owner === 'game' && Math.abs(pebble.hx - 0.2) < 1e-6 && Math.abs(pebble.hz - 0.3) < 1e-6 && Math.abs(Math.atan2(pebble.sin, pebble.cos)) > 0.5, 'a small prop the size rule gives no collision is visited by its turned box');
const rock = seen.get('object/rock');
ok(!!rock && rock.kind === 'box' && Math.abs(rock.hx - 13) < 1e-6 && Math.abs(rock.x - ROCK_AT.x) < 1e-6, "the world's rock by its box");
const hall = seen.get('place/hall-1');
ok(!!hall && hall.kind === 'box' && hall.owner === 'ours' && Math.abs(hall.hx - 10) < 1e-6, 'a building of ours by its box, ours');
const crate = seen.get('place/crate-1');
ok(!!crate && crate.kind === 'carry' && crate.owner === 'ours' && Math.abs(crate.y) < 1e-6, 'a permanent prop as one to carry (never kept off), ours');
const home = seen.get('home:7');
ok(!!home && home.kind === 'box' && home.owner === 'player' && Math.abs(home.hx - 10) < 1e-6, "a player's house by its box, the player's");
// The walk-through tree: no parts of its own, so kept off by the guess's slim trunk (`trunkRadius`), never by nothing.
const wro = seen.get('object/wroshyr');
const wroRadius = (h.s.loadedOf('wroshyr', undefined)?.radius as number | undefined) ?? radiusOfBounds(WROSHYR.bounds);
ok(!!wro && wro.kind === 'trunk' && wro.owner === 'game' && wro.r > 0 && Math.abs(wro.r - trunkRadius(wroRadius, FLORA_COLLISION)) < 1e-9, `a walk-through tree (a NULL extent) is visited by its trunk, trunkRadius of its own radius (${wro?.r.toFixed(2)} m)`);
// What lies dormant, of the world's other state: kept off as the game's own, so the next arrival in that state does not stand a building buried or in the air.
ok(h.stream.dormantCount === 1, 'the living city\'s hall lies dormant in the ruins (its state is not this arrival\'s)');
const hall2 = seen.get('object/living_hall');
ok(!!hall2 && hall2.kind === 'box' && hall2.owner === 'game' && Math.abs(hall2.hx - 13) < 1e-6 && Math.abs(hall2.x - 170) < 1e-6, "what lies dormant is visited by its box too, the game's");
// The air's walk steps over the tree and the pebble (what the brush must not lean on).
const solid = new Set<string>();
const box: SolidBox = { x: 0, z: 0, hx: 0, hz: 0, cos: 1, sin: 0, top: 0, room: false };
let n = 0;
h.stream.forEachSolidBox(0, 0, 200, 200, box, (b) => {
  n++;
  if (Math.abs(b.x - 60) < 1 && Math.abs(b.z - 70) < 1) solid.add('tree');
  if (Math.abs(b.x - 80) < 1 && Math.abs(b.z - 120) < 1) solid.add('pebble');
  return true;
});
ok(n > 0 && !solid.has('tree') && !solid.has('pebble'), "and `forEachSolidBox` steps over both, which is why the brush has a walk of its own");

console.log(`\nstandingFoot: ${checks} checks passed`);
