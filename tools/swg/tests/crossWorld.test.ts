// A row out of another world (DESIGN.md §2.5, §2.7 `from`): the light guest loader fetches a world's manifest and the
// files beside it but never its `layout.json`; a `from` row stands out of that world's pack (folded into its tier's bulk
// when filed before the tier loads, map-maker wave 3, its tier's model map keyed by pack and id; the runtime path
// otherwise) even where this world carries a model of the same id, and collides out of it; its client data's effects are placed by the streamer
// from that pack's folder (the particle player stood in, so the call site is what is held); and the guest is released
// with the world. The real streamer and the real physics (`streamHarness.ts`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { boxGeo, loadedOf, makeStreamer, THREE } from './streamHarness.ts';

const { AssetPack } = await import('../../../src/world/assetPack.ts');
const { dressingStandOf } = await import('../../../src/world/permanent.ts');
const { toGame } = await import('../../../src/story/placements.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- The light loader asks for no layout. ----
{
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    asked.push(u);
    if (u.endsWith('/manifest.json')) return new Response(JSON.stringify({ planet: 'testworld', categories: { layout: [{ id: 'crate', file: 'crate.glb', bounds: { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: 12 }], flora: [{ id: 'tree', file: 'tree.glb', bounds: { min: [-3, 0, -3], max: [3, 9, 3] }, triangles: 12 }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('not here', { status: 404, headers: { 'content-type': 'text/plain' } });
  }) as typeof fetch;
  try {
    const light = await AssetPack.load('testworld_light', '/', { layout: false });
    ok(!!light && !!light.find('crate'), 'the light loader reads the manifest');
    ok(!asked.some((u) => u.includes('testworld_light/layout.json')), `and asks for no layout.json (${asked.filter((u) => u.includes('testworld_light')).map((u) => u.split('/').pop()).join(', ')})`);
    ok(asked.some((u) => u.includes('testworld_light/flora-collision.json')), "but does ask for the trees' own collision shapes");
    const whole = await AssetPack.load('testworld_whole', '/');
    ok(!!whole && asked.some((u) => u.includes('testworld_whole/layout.json')), 'the plain load asks for the layout, as it always has');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---- A `from` row stands and collides out of that world's pack. ----
{
  // The particle player stood in, so what the streamer itself places for a stood row, and from which file, is seen.
  const placed: string[] = [];
  const fx = {
    place: (file: string) => {
      placed.push(file);
      return {};
    },
    remove: () => {},
  };
  const h = await makeStreamer(undefined, { effects: fx });
  // Naboo's own crate: three metres tall, where this world's is one.
  const NABOO_CRATE = { id: 'crate', file: 'crate.glb', bounds: { min: [-1.5, 0, -1.5], max: [1.5, 3, 1.5] }, triangles: 12 };
  const nabooGeo = boxGeo(3, 3, 3, 0);
  const nabooModel = loadedOf(NABOO_CRATE, [{ geometry: nabooGeo, cell: -1 }]);
  const ready = new Map<string, unknown>();
  const naboo = {
    manifest: { planet: 'naboo', categories: { layout: [NABOO_CRATE] } },
    root: '/assets-private/naboo/',
    objectEffects: { 'object/tangible/test/shared_brazier.iff': [{ file: 'particles/fx_test_fire.json', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }] },
    doors: null,
    find: (id: string) => (id === 'crate' ? NABOO_CRATE : undefined),
    isFlora: () => false,
    loaded: (id: string) => ready.get(id) ?? null,
    model: async (id: string) => {
      if (id !== 'crate') throw new Error(`no ${id}`);
      ready.set(id, nabooModel);
      return nabooModel;
    },
  };
  const row = { id: 'naboo-crate-1', kind: 'prop' as const, pack: 'world' as const, model: 'crate', from: 'naboo', template: 'object/tangible/test/shared_brazier.iff', x: -40, y: 0, z: 40, q: [1, 0, 0, 0] as [number, number, number, number] };
  const g = toGame(row as never, { x: 0, z: 0 }, 'raw');
  const stand = dressingStandOf(row as never, g, 'place/naboo-crate-1', () => null, () => false);
  ok(!!stand && stand.from === 'naboo' && stand.effectsOf === 'object/tangible/test/shared_brazier.iff', "the row's stand carries its world and its template");
  const answer = h.stream.standPermanent(stand!, naboo as never);
  ok(!!answer && Math.abs(Math.abs(answer.bounds!.max[1] - answer.bounds!.min[1]) - 3) < 1e-9, "it stands out of Naboo's pack: Naboo's crate's box, not this world's");
  await h.settle({ x: g.x, z: g.z }, 40);
  await answer!.built;
  let mine = 0;
  let theirs = 0;
  for (const c of h.scene.children) {
    const m = c as THREE.InstancedMesh;
    if (!m.isInstancedMesh) continue;
    if (m.geometry === nabooGeo) theirs++;
  }
  for (const c of h.scene.children) if ((c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.InstancedMesh).geometry !== nabooGeo) mine++;
  ok(theirs === 1, `drawn on Naboo's own geometry (${theirs} mesh of it, ${mine} of anything else)`);
  const top = h.rayDown(g.x, g.z, 20);
  ok(top !== null && Math.abs(top - 3) < 0.05, `and solid at Naboo's crate's height (${top?.toFixed(2)} m, where this world's would be 1)`);
  // What the streamer really placed for the stood row, at its own call site (the row's pack handed on), not the helper's answer.
  ok(placed.length === 1 && placed[0] === '../naboo/particles/fx_test_fire.json', `its client data's effects are placed from Naboo's folder (${placed.join(', ') || 'none placed'})`);
  // A row that names no other world finds this world's crate, exactly as before, and this world's table, which hangs nothing on it.
  const plain = dressingStandOf({ ...row, id: 'plain-crate', from: undefined } as never, toGame({ ...row, x: -60 } as never, { x: 0, z: 0 }, 'raw'), 'place/plain-crate', () => null, () => false);
  const plainAnswer = h.stream.standPermanent(plain!, h.s.pack);
  const plainAt = toGame({ ...row, x: -60 } as never, { x: 0, z: 0 }, 'raw');
  await h.settle({ x: plainAt.x, z: plainAt.z }, 40);
  await plainAnswer!.built;
  ok(!!plainAnswer && Math.abs(Math.abs(plainAnswer.bounds!.max[1] - plainAnswer.bounds!.min[1]) - 1) < 1e-9, "and one naming no world stands this world's own");
  ok(placed.length === 1, `and places nothing out of Naboo's table (${placed.length} effect placed in all)`);
}

// ---- Folded into its tier (map-maker wave 3): a `from` row whose id the world also carries draws out of its own pack. ----
{
  const placed: string[] = [];
  /** Every handle placed, and those taken away (each once, or the bookkeeping is wrong). */
  const handles: object[] = [];
  const removed: object[] = [];
  const fx = {
    place: (file: string) => {
      placed.push(file);
      const handle = { file };
      handles.push(handle);
      return handle;
    },
    remove: (handle: object) => void removed.push(handle),
  };
  // This world's own crate standing in the same tier as the Naboo one, so the tier's model map holds both ids alike.
  const h = await makeStreamer(
    [
      { template: 'object/rock', model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
      { template: 'object/crate', model: 'crate', x: -44, y: 0, z: 40, q: [1, 0, 0, 0], radius: 1 },
    ],
    { effects: fx },
  );
  const NABOO_CRATE = { id: 'crate', file: 'crate.glb', bounds: { min: [-1.5, 0, -1.5], max: [1.5, 3, 1.5] }, triangles: 12 };
  const nabooGeo = boxGeo(3, 3, 3, 0);
  const nabooModel = loadedOf(NABOO_CRATE, [{ geometry: nabooGeo, cell: -1 }]);
  const ready = new Map<string, unknown>();
  const naboo = {
    manifest: { planet: 'naboo', categories: { layout: [NABOO_CRATE] } },
    root: '/assets-private/naboo/',
    objectEffects: { 'object/tangible/test/shared_brazier.iff': [{ file: 'particles/fx_test_fire.json', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] }] },
    doors: null,
    find: (id: string) => (id === 'crate' ? NABOO_CRATE : undefined),
    isFlora: () => false,
    loaded: (id: string) => ready.get(id) ?? null,
    model: async (id: string) => {
      if (id !== 'crate') throw new Error(`no ${id}`);
      ready.set(id, nabooModel);
      return nabooModel;
    },
  };
  const row = { id: 'naboo-crate-2', kind: 'prop' as const, pack: 'world' as const, model: 'crate', from: 'naboo', template: 'object/tangible/test/shared_brazier.iff', x: -40, y: 0, z: 40, q: [1, 0, 0, 0] as [number, number, number, number] };
  const g = toGame(row as never, { x: 0, z: 0 }, 'raw');
  // Filed before its tier loads, as an arrival files every row.
  h.stream.standPermanent(dressingStandOf(row as never, g, 'place/naboo-crate-2', () => null, () => false)!, naboo as never);
  await h.settle({ x: g.x, z: g.z }, 40);
  const o = h.stream.placedOf('place/naboo-crate-2')!;
  ok(!!h.s.foldOf.get(o) && !h.s.runtime.get(o), 'filed before its tier loaded, the row out of another world is folded into the bulk');
  const naboos = h.scene.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.InstancedMesh).geometry === nabooGeo);
  ok(naboos.length === 1 && (naboos[0] as THREE.InstancedMesh).count === 1, "drawn on Naboo's own geometry, in a mesh of its own (the tier's model map is keyed by pack and id)");
  // This world's crate: the mesh holding an instance at its place, on a geometry a metre tall.
  const m4 = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const ownMeshes = h.scene.children.filter((c) => {
    const m = c as THREE.InstancedMesh;
    if (!m.isInstancedMesh) return false;
    for (let i = 0; i < m.count; i++) {
      at.setFromMatrixPosition((m.getMatrixAt(i, m4), m4));
      if (Math.abs(at.x - 44) < 0.01 && Math.abs(at.z - 40) < 0.01) return true;
    }
    return false;
  }) as THREE.InstancedMesh[];
  ownMeshes[0]?.geometry.computeBoundingBox();
  ok(ownMeshes.length === 1 && ownMeshes[0].geometry !== nabooGeo && Math.abs(ownMeshes[0].geometry.boundingBox!.max.y - 1) < 1e-9, "while this world's own crate beside it stays this world's, a metre tall");
  const top = h.rayDown(g.x, g.z, 20);
  ok(top !== null && Math.abs(top - 3) < 0.05, `and solid at Naboo's crate's height (${top?.toFixed(2)} m)`);
  ok(placed.length === 1 && placed[0] === '../naboo/particles/fx_test_fire.json', `its effects placed by the bulk from Naboo's folder (${placed.join(', ') || 'none'})`);
  // Taken down the way the game takes a row down (`unplaceMany`, the permanent layer's sync and every editor write): its
  // slot hidden in place and its effect taken away, once, out of its tier's list, which the unload walks.
  const tier = h.s.foldOf.get(o).tier;
  const fire = handles[0];
  ok(tier.effects.includes(fire), "the tier keeps the folded row's effect in its own list");
  h.stream.unplaceMany(['place/naboo-crate-2']);
  ok(removed.length === 1 && removed[0] === fire && !tier.effects.includes(fire), `taken down whole, its effect is taken away once and out of its tier's list (${removed.length} taken away)`);
  ok(h.s.foldOf.get(o).hidden === 2 && h.meshesAt(g.x, g.z) === 0, 'and its slot draws nothing');
  // Shown again (a removal undone, the fifth wave's): its effect placed again, once, into the tier's list.
  ok(h.stream.showInPlace(o) && placed.length === 2 && tier.effects.includes(handles[1]) && tier.effects.length === 1, 'shown again, its effect is placed again, once');
  // A second row, in a region of its own, folded at its tier's load; its tier unloaded: its effect taken away with the
  // tier, once, its record gone with it, and a removal after that (the row is still filed) takes nothing away again.
  const row3 = { ...row, id: 'naboo-crate-3', x: -640 };
  const g3 = toGame(row3 as never, { x: 0, z: 0 }, 'raw');
  h.stream.standPermanent(dressingStandOf(row3 as never, g3, 'place/naboo-crate-3', () => null, () => false)!, naboo as never);
  await h.settle({ x: g3.x, z: g3.z }, 40);
  const o3 = h.stream.placedOf('place/naboo-crate-3')!;
  const rec3 = h.s.foldOf.get(o3);
  ok(!!rec3 && rec3.fx.length === 1 && !!rec3.fx[0].h, 'a row in a region of its own is folded at its own tier\'s load, its effect placed');
  const before = removed.length;
  h.s.unloadTier(h.s.regions.get(`${Math.floor(g3.x / 256)},${Math.floor(g3.z / 256)}`), o3.tier);
  ok(!h.s.foldOf.get(o3) && removed.length === before + 1 && removed[before] === rec3.fx[0].h, `unloaded, its effect is taken away with the tier once and its record goes with it (${removed.length - before} taken away)`);
  h.stream.unplaceMany(['place/naboo-crate-3']);
  ok(removed.length === before + 1 && !h.stream.placedOf('place/naboo-crate-3'), 'and taken down after, nothing of it is taken away a second time');
}

// ---- The guest goes with the world. ----
{
  const here = dirname(fileURLToPath(import.meta.url));
  const world = readFileSync(join(here, '..', '..', '..', 'src', 'world', 'world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/for \(const g of this\.guestWorldsReady\.values\(\)\) this\.releaseGuest\(g\);\s*this\.guestWorldsReady\.clear\(\);\s*this\.guestWorlds\.clear\(\);/.test(world), "every guest world is released with the world (`releaseGuest`, which forgets its materials first)");
  ok(/AssetPack\.load\(id, import\.meta\.env\.BASE_URL, \{ layout: false \}\)/.test(world), 'and is loaded light');
}

console.log(`\n${checks} checks passed`);
