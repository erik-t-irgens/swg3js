// A tree put down for good (DESIGN.md §2.7, §4): a permanent row of a flora model is ruled and collides as a tree -- by
// its own collision extent (a trunk's cylinder, never every triangle of its canopy), by nothing for one the client
// walked through, by the guessed cylinder for a pack with no shapes -- while the snapshot's own placed objects keep their
// trimesh. A guest world's flora is flora to the streamer's rule (`packFlora`) and to the moving air's walk
// (`forEachSolidBox`); and every model of the world's own answers as it always did. The real streamer and the real
// physics (`streamHarness.ts`).
import assert from 'node:assert/strict';
import { boxGeo, loadedOf, makeStreamer, THREE } from './streamHarness.ts';

const { dressingStandOf } = await import('../../../src/world/permanent.ts');
const { toGame } = await import('../../../src/story/placements.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A tree: a trunk 0.6 m across and 3 m tall under a canopy 6 m across from 3 to 8 m, as one mesh. */
function treeGeo(): THREE.BufferGeometry {
  const trunk = boxGeo(0.6, 3, 0.6, 0);
  const canopy = boxGeo(6, 5, 6, 3);
  const pos = [...(trunk.getAttribute('position').array as ArrayLike<number>), ...(canopy.getAttribute('position').array as ArrayLike<number>)];
  const tn = trunk.getAttribute('position').count;
  const idx = [...(trunk.getIndex()!.array as ArrayLike<number>), ...Array.from(canopy.getIndex()!.array as ArrayLike<number>, (i) => i + tn)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const bounds = { min: [-3, 0, -3], max: [3, 8, 3] };
const TREE = { id: 'tree', file: 'tree.glb', bounds, triangles: 24, collision: { kind: 'CMPA', shapes: [{ t: 'cyl', c: [0, 0, 0], r: 0.3, h: 3 }] } };
const BUSH = { id: 'bush', file: 'bush.glb', bounds, triangles: 24, collision: { kind: 'NULL', shapes: [] } };
const OLD = { id: 'old_tree', file: 'old.glb', bounds, triangles: 24 };
const h = await makeStreamer(undefined, {
  defs: [TREE as never, BUSH as never, OLD as never],
  models: {
    tree: loadedOf(TREE as never, [{ geometry: treeGeo(), cell: -1 }]),
    bush: loadedOf(BUSH as never, [{ geometry: treeGeo(), cell: -1 }]),
    old_tree: loadedOf(OLD as never, [{ geometry: treeGeo(), cell: -1 }]),
  },
  flora: ['tree', 'bush', 'old_tree'],
});
const world = h.s.pack;

/** A permanent row of a model at a raw place, stood and built; answers its game place. */
async function standRow(id: string, model: string, x: number, z: number, from: unknown = world, fromId?: string) {
  const row = { id, kind: 'prop', pack: 'world', model, x, y: 0, z, q: [1, 0, 0, 0], ...(fromId ? { from: fromId } : {}) };
  const g = toGame(row as never, { x: 0, z: 0 }, 'raw');
  const stand = dressingStandOf(row as never, g, `place/${id}`, () => null, () => false);
  const answer = h.stream.standPermanent(stand!, from as never);
  await h.settle({ x: g.x, z: g.z }, 40);
  await answer?.built;
  await h.settle({ x: g.x, z: g.z }, 4);
  return g;
}

{
  const g = await standRow('tree-1', 'tree', -30, 30);
  const o = h.stream.placedOf('place/tree-1')!;
  const cols = h.s.colliders.get(o) as { shape: { type: number } }[] | undefined;
  ok(!!cols && cols.length === 1, `a permanent tree collides as one shape, its trunk (${cols?.length} collider${cols?.length === 1 ? '' : 's'}, never a trimesh of every triangle)`);
  const trunk = h.rayDown(g.x, g.z, 20);
  ok(trunk !== null && Math.abs(trunk - 3) < 0.05, `a ray at its trunk stops at the trunk's top (${trunk?.toFixed(2)} m)`);
  const canopy = h.rayDown(g.x + 2.5, g.z, 20);
  ok(canopy === null, 'and one through its canopy passes (the canopy is no ceiling to walk on)');
}
{
  const g = await standRow('bush-1', 'bush', -60, 30);
  const o = h.stream.placedOf('place/bush-1')!;
  ok((h.s.colliders.get(o)?.length ?? 0) === 0 && h.rayDown(g.x, g.z, 20) === null, 'a NULL extent is walked through, as the client walked through it');
}
{
  const g = await standRow('old-1', 'old_tree', -90, 30);
  const o = h.stream.placedOf('place/old-1')!;
  const n = h.s.colliders.get(o)?.length ?? 0;
  const top = h.rayDown(g.x, g.z, 20);
  ok(n === 1 && top !== null && Math.abs(top - 8) < 0.05, `a pack with no shapes stands on the guessed cylinder (${n} collider, ${top?.toFixed(2)} m tall)`);
}
{
  // A snapshot object of a flora model keeps its trimesh, exactly as before: the world's own placed trees.
  const h2 = await makeStreamer([{ template: 'object/tree', model: 'tree', x: -10, y: 0, z: 10, q: [1, 0, 0, 0], radius: 4 }], { defs: [TREE as never], models: { tree: loadedOf(TREE as never, [{ geometry: treeGeo(), cell: -1 }]) }, flora: ['tree'] });
  await h2.settle({ x: 10, z: 10 }, 60);
  const canopy = h2.rayDown(10 + 2.5, 10, 20);
  ok(canopy !== null && Math.abs(canopy - 8) < 0.05, `the snapshot's own placed tree keeps its trimesh, canopy and all (${canopy?.toFixed(2)} m)`);
}
{
  // A guest world's tree: flora by its own pack's word, to the rule and to the air.
  const GUEST = { id: 'guest_palm', file: 'palm.glb', bounds, triangles: 24, collision: { kind: 'CMPA', shapes: [{ t: 'cyl', c: [0, 0, 0], r: 0.4, h: 4 }] } };
  const model = loadedOf(GUEST as never, [{ geometry: treeGeo(), cell: -1 }]);
  const ready = new Map<string, unknown>();
  const guest = {
    manifest: { planet: 'naboo', categories: { flora: [GUEST] } },
    root: '/assets-private/naboo/',
    objectEffects: null,
    doors: null,
    find: (id: string) => (id === GUEST.id ? GUEST : undefined),
    isFlora: (d: { id: string }) => d.id === GUEST.id,
    loaded: (id: string) => ready.get(id) ?? null,
    model: async () => {
      ready.set(GUEST.id, model);
      return model;
    },
  };
  const g = await standRow('palm-1', 'guest_palm', -120, 30, guest, 'naboo');
  ok(h.s.packFlora(model) === true, "a guest world's tree is flora to the streamer's rule, by its own pack's word");
  const top = h.rayDown(g.x, g.z, 20);
  ok(top !== null && Math.abs(top - 4) < 0.05, `and collides by its own extent (${top?.toFixed(2)} m)`);
  // A crate of the world's own beside it, which the air's walk takes as an obstacle: the control.
  await standRow('crate-near', 'crate', -125, 30);
  let seen = 0;
  const box = { x: 0, z: 0, hx: 0, hz: 0, cx: 1, sx: 0, top: 0, room: false };
  h.stream.forEachSolidBox(g.x - 12, g.z - 12, g.x + 12, g.z + 12, box as never, () => {
    seen++;
    return true;
  });
  ok(seen === 1, `and the moving air's walk passes it over as flora, as it passes the world's own, while it takes the crate beside it (${seen} obstacle)`);
}
{
  // The world editor's order: another world's tree taken in hand -- its model loaded and its ghost built, which asks
  // whether it is flora -- before the row of it stands and hands its pack over. The ghost's question must not be kept as
  // the answer: the row stood after it still collides by its trunk, its canopy no ceiling.
  const OAK = { id: 'guest_oak', file: 'oak.glb', bounds, triangles: 24, collision: { kind: 'CMPA', shapes: [{ t: 'cyl', c: [0, 0, 0], r: 0.4, h: 3 }] } };
  const model = loadedOf(OAK as never, [{ geometry: treeGeo(), cell: -1 }]);
  const ready = new Map<string, unknown>();
  const guest = {
    manifest: { planet: 'endor', categories: { flora: [OAK] } },
    root: '/assets-private/endor/',
    objectEffects: null,
    doors: null,
    find: (id: string) => (id === OAK.id ? OAK : undefined),
    isFlora: (d: { id: string }) => d.id === OAK.id,
    loaded: (id: string) => ready.get(id) ?? null,
    model: async () => {
      ready.set(OAK.id, model);
      return model;
    },
  };
  const loaded = await h.stream.modelFor(OAK.id, guest as never);
  const ghost = h.stream.ghostMeshesOf(loaded);
  ok(ghost.length === 1, "the ghost is built of another world's tree before any row of it stands");
  const g = await standRow('oak-1', 'guest_oak', -150, 30, guest, 'endor');
  ok(h.s.packFlora(model) === true, 'and the row stood after it is flora by its own pack\'s word, the ghost\'s question not kept');
  const trunk = h.rayDown(g.x, g.z, 20);
  ok(trunk !== null && Math.abs(trunk - 3) < 0.05, `it collides by its trunk (${trunk?.toFixed(2)} m)`);
  ok(h.rayDown(g.x + 2.5, g.z, 20) === null, 'and a ray through its canopy passes');
}
{
  // Every model of the world's own answers what it always answered.
  const crate = await h.stream.loadModel('crate');
  const tree = await h.stream.loadModel('tree');
  ok(h.s.packFlora(crate) === false && h.s.packFlora(tree) === true, "the world's own crate is not flora and its own tree is");
}

console.log(`\n${checks} checks passed`);
