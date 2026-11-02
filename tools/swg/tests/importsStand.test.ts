// A row of one of the owner's own models (Map-maker II's tenth wave, `pack: 'imported'`) stood through the real streamer and
// the real physics (`streamHarness.ts`):
//
//   1. the pack it stands out of is the shipped folder's where that holds the model and the private one's otherwise
//      (`importPackFor`, the very function `World.importPackOf` asks), so shipping a model changes no row: a shed of one id
//      in both stands at the shipped one's height;
//   2. a `-colonly` stand-in (`colliderOnly`, `extras.swgColliderOnly`) collides and is drawn nowhere, and a `-nocol` piece
//      (`extras.swgNoCollide`) is drawn and never collided, folded into its tier as an arrival files it and stood in play on
//      meshes of its own alike;
//   3. a placements file holding such a row is read by today's reader whole, and by the reader as it stood before the wave
//      (7bfc09e's `placements.ts`, out of git, else held to the answer recorded from it) with that row skipped and named and
//      every other row read; and every placements file on disk, the owner's own as he edits them, reads alike through both
//      but for its imported rows, which the old reader skips and names;
//   4. Reload imports' own halves run: `PermanentLayer.takeDownWhere` and `resync` take down and stand again the imported
//      rows alone, and `LayoutStreamer.forgetPack` leaves no list of the streamer's looking in the pack let go; a piece of an
//      imported model names no look's donor;
//   5. the dev server's imports middlewares open only a file inside their folder (`servedFile`); and the hand-overs only the
//      game makes, as text.
//
// Run: node tools/swg/tests/importsStand.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { boxGeo, loadedOf, makeStreamer, THREE } from './streamHarness.ts';
import { loadOld, REPO } from './oldModules.ts';
import { servedFile } from '../../dev/servedFile.mjs';

const { dressingStandOf, PermanentLayer } = await import('../../../src/world/permanent.ts');
const { toGame, readPlacementsFile, placementsFileText } = await import('../../../src/story/placements.ts');
const { importPackFor } = await import('../../../src/world/packFiles.ts');
const { RowMaterials } = await import('../../../src/world/rowMaterials.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The wave's start, whose reader knew no imported pack. */
const BEFORE_WAVE = '7bfc09e';

// ---- The two folders' packs, as `AssetPack.load(..., { dir })` hands them over. ----
const SHED_SHIPPED = { id: 'shed', file: 'shed.11111111.glb', bounds: { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: 12 };
const SHED_PRIVATE = { id: 'shed', file: 'shed.22222222.glb', bounds: { min: [-1, 0, -1], max: [1, 1, 1] }, triangles: 12 };
/** Its record borrows a tint for its paint (`def.looks`, the import pass's own look of the model). */
const HUT = { id: 'hut', file: 'hut.33333333.glb', bounds: { min: [-1.5, 0, -1.5], max: [3.5, 3, 1.5] }, triangles: 36, looks: [{ of: 'hut:Paint:nocol', tint: '#ff0000' }] };
/** An import under an id the world's own pack also carries (its crate, a metre tall): four metres tall. */
const OWN_CRATE = { id: 'crate', file: 'crate.44444444.glb', bounds: { min: [-1, 0, -1], max: [1, 4, 1] }, triangles: 12 };
const ownCrateGeo = boxGeo(2, 4, 2, 0);
const shippedShedGeo = boxGeo(2, 2, 2, 0);
const privateShedGeo = boxGeo(2, 1, 2, 0);
/** The hut's body (drawn, never collided: its stand-in is what collides), its sign off to one side, and the stand-in itself. */
const bodyGeo = boxGeo(2, 2, 2, 0);
const signGeo = boxGeo(1, 0.2, 0.2, 2.4).translate(3, 0, 0);
const standGeo = boxGeo(3, 3, 3, 0);
const nocol = new THREE.MeshStandardMaterial();
nocol.name = 'hut:Paint:nocol';
nocol.userData.swgNoCollide = true;
const colonly = new THREE.MeshStandardMaterial();
colonly.name = 'hut:colonly';
colonly.userData.swgColliderOnly = true;
const hutModel = { ...loadedOf(HUT, [{ geometry: bodyGeo, cell: -1, material: nocol }, { geometry: signGeo, cell: -1, material: nocol }]), colliderOnly: [{ geometry: standGeo, material: colonly, cell: -1 }] };

function importsPack(dir: string, defs: (typeof HUT)[], models: Record<string, unknown>) {
  const ready = new Map<string, unknown>();
  const asked: string[] = [];
  return {
    asked,
    manifest: { planet: 'imported', categories: { layout: defs, flora: [] } },
    root: `/${dir}`,
    imported: true,
    objectEffects: null,
    doors: null,
    find: (id: string) => defs.find((d) => d.id === id),
    isFlora: () => false,
    loaded: (id: string) => ready.get(id) ?? null,
    model: async (id: string) => {
      asked.push(id);
      const m = models[id];
      if (!m) throw new Error(`no ${id}`);
      ready.set(id, m);
      return m;
    },
  };
}
const shipped = importsPack('imports/', [SHED_SHIPPED], { shed: loadedOf(SHED_SHIPPED, [{ geometry: shippedShedGeo, cell: -1 }]) });
const priv = importsPack('imports-private/', [SHED_PRIVATE, HUT, OWN_CRATE], { shed: loadedOf(SHED_PRIVATE, [{ geometry: privateShedGeo, cell: -1 }]), hut: hutModel, crate: loadedOf(OWN_CRATE, [{ geometry: ownCrateGeo, cell: -1 }]) });
const packs = { shipped, private: priv };

{
  ok(importPackFor(packs, 'shed') === shipped && importPackFor(packs, 'hut') === priv && importPackFor(packs, 'nothing') === null && importPackFor(null, 'shed') === null, 'a model stands out of the shipped folder where that holds it, the private one otherwise, and neither for an id in neither');
  ok(importPackFor({ shipped: null, private: priv }, 'shed') === priv, 'with no shipped folder (the dev server before anything ships), out of the private one');
}

/** Every instanced mesh in the scene drawing a geometry. */
const drawing = (scene: THREE.Scene, geo: THREE.BufferGeometry) => scene.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh && (c as THREE.InstancedMesh).geometry === geo).length;

// The world's own things of the hut's and the shed's sizes in the same region, so in play their tiers are built before the
// rows are filed (and the rows stand on meshes of their own, as a row put down in play does).
const WORLD_HUT = { ...HUT, id: 'worldhut', file: 'worldhut.glb' };
const WORLD_SHED = { ...SHED_SHIPPED, id: 'worldshed', file: 'worldshed.glb' };
const neighbours = [
  { template: 'object/rock', model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
  { template: 'object/worldhut', model: 'worldhut', x: -20, y: 0, z: 10, q: [1, 0, 0, 0], radius: 4 },
  { template: 'object/worldshed', model: 'worldshed', x: -30, y: 0, z: 10, q: [1, 0, 0, 0], radius: 2 },
];
const neighbourModels = { worldhut: loadedOf(WORLD_HUT, [{ geometry: boxGeo(1, 1, 1, 0), cell: -1 }]), worldshed: loadedOf(WORLD_SHED, [{ geometry: boxGeo(1, 1, 1, 0), cell: -1 }]) };

for (const way of ['folded', 'in play'] as const) {
  const h = way === 'folded' ? await makeStreamer() : await makeStreamer(neighbours, { defs: [WORLD_HUT, WORLD_SHED], models: neighbourModels });
  const looks = new RowMaterials({ forget: () => {} });
  h.s.looks = looks;
  const at = (x: number) => ({ x, z: 40 });
  const stand = (id: string, model: string, x: number) => {
    const row = { id, kind: 'prop' as const, pack: 'imported' as const, model, x: -x, y: 0, z: 40, q: [1, 0, 0, 0] as [number, number, number, number] };
    const g = toGame(row as never, { x: 0, z: 0 }, 'raw');
    const s = dressingStandOf(row as never, g, `place/${id}`, () => null, () => false);
    assert.ok(s && s.imported === true, 'an imported row\'s stand says so');
    const pack = importPackFor(packs, model)!;
    return h.stream.standPermanent(s!, pack as never);
  };
  if (way === 'in play') await h.settle(at(40), 40);
  const shed = stand('shed-1', 'shed', 40);
  const hut = stand('hut-1', 'hut', 60);
  const crate = stand('crate-1', 'crate', 80);
  ok(!!shed && !!hut && !!crate, `${way}: the rows are filed`);
  await h.settle(at(60), 60);
  await shed!.built;
  await hut!.built;
  await crate!.built;
  const crateTop = h.rayDown(80, 40, 20);
  ok(crateTop !== null && Math.abs(crateTop - 4) < 0.05 && drawing(h.scene, ownCrateGeo) === 1, `${way}: an import under an id the world's own pack carries stands out of the import, not the world (${crateTop?.toFixed(2)} m, where the world's crate is 1)`);
  const shedTop = h.rayDown(40, 40, 20);
  ok(shedTop !== null && Math.abs(shedTop - 2) < 0.05 && drawing(h.scene, shippedShedGeo) === 1 && drawing(h.scene, privateShedGeo) === 0, `${way}: the shed stands out of the shipped folder, solid at its 2 m and drawn on its geometry (${shedTop?.toFixed(2)} m), the private one of the same id nowhere`);
  const hutTop = h.rayDown(60, 40, 20);
  ok(hutTop !== null && Math.abs(hutTop - 3) < 0.05, `${way}: the hut collides by its stand-in, 3 m up, not its 2 m body (${hutTop?.toFixed(2)} m)`);
  ok(drawing(h.scene, standGeo) === 0 && drawing(h.scene, bodyGeo) === 1, `${way}: the stand-in is drawn nowhere, the body is drawn`);
  const signTop = h.rayDown(63, 40, 20);
  ok(drawing(h.scene, signGeo) === 1 && signTop === null, `${way}: the -nocol sign is drawn and nothing collides where it stands (${signTop})`);
  const o = h.stream.placedOf('place/hut-1')!;
  if (way === 'folded') ok(!!h.s.foldOf.get(o), 'filed before its tier loaded, the imported row is folded into the bulk as any permanent row is');
  else ok(!h.s.foldOf.get(o) && !!h.s.runtime.get(o), 'stood after its tier was built, on meshes of its own');
  // The model's own borrowed look (its record's), worn by a row that names none of its own.
  const meshes: THREE.InstancedMesh[] = way === 'folded' ? h.s.foldOf.get(o).slots.map((s: { mesh: THREE.InstancedMesh }) => s.mesh) : h.s.runtime.get(o).meshes;
  const paint = meshes.map((m) => m.material as THREE.MeshStandardMaterial).filter((m) => m.name === 'hut:Paint:nocol');
  ok(paint.length >= 1 && paint.every((m) => looks.isCopy(m) && m.color.equals(new THREE.Color('#ff0000'))), `${way}: the model's own borrowed look is worn by a row naming none (its paint a copy tinted as its record says)`);
  // An imported model lends no look: the look picker is told so of its drawn copy and its source alike, and named no donor.
  ok(h.stream.donorRefOf(paint[0]) === null && h.stream.donorRefOf(nocol) === null && h.stream.donorIsImported(paint[0]) && h.stream.donorIsImported(nocol) && !h.stream.donorIsImported(new THREE.MeshStandardMaterial()), `${way}: a piece of the imported model names no donor and is known for one of the owner's own`);
}

// ---- The reader before the wave skips such a row and names it; today's reads it; a file without one reads alike. ----
{
  // A file of two rows, a props crate and a building out of the imports, as the writer writes it (written out, so what the
  // reader before the wave made of it can be held to a hash recorded from that reader where git cannot hand it over).
  const text =
    '{\n  "version": 1,\n  "world": "tatooine",\n  "frame": "raw",\n  "rows": [\n' +
    '    { "id": "crate-1", "kind": "prop", "pack": "props", "thing": "crate", "x": 1, "y": 0, "z": 2, "q": [0,0,0,1] },\n' +
    '    { "id": "hut-1", "kind": "building", "pack": "imported", "model": "test_hut", "x": 10, "y": 0, "z": 20, "q": [0,0,0,1] }\n' +
    '  ]\n}\n';
  /** What 7bfc09e's reader made of `text` (`JSON.stringify` of its answer, SHA-1, sixteen hex): its crate read, the hut skipped and named. */
  const BEFORE_WAVE_VERDICT = 'b2b6c79073884062';
  const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
  const now = readPlacementsFile(text, 'tatooine', 'ground');
  ok(now.rows.length === 2 && now.rows[1].pack === 'imported' && now.rows[1].model === 'test_hut' && !now.skipped.length, "today's reader reads a building out of the imports");
  ok(placementsFileText('tatooine', 'raw', now.rows) === text, "and writes it back as the writer wrote it, byte for byte");
  // Today's reading less the imported row, with that row skipped in the old reader's words, is what the old reader read: held
  // to the answer recorded from it, so a machine git cannot hand it to still holds today's reader to it.
  const asBefore = { rows: now.rows.filter((r) => r.pack !== 'imported'), skipped: [{ id: 'hut-1', why: 'its pack is not props, gallery or world' }], unknown: now.unknown, problem: now.problem };
  ok(sha(JSON.stringify(asBefore)) === BEFORE_WAVE_VERDICT, `today's reader reads the file's other row as the reader before the wave did, which skipped the imported one and named it (held to the answer recorded from that reader, ${BEFORE_WAVE_VERDICT})`);
  const old = await loadOld<{ readPlacementsFile: typeof readPlacementsFile }>(['src/story/placements.ts'], 'src/story/placements.ts', BEFORE_WAVE);
  if (old) {
    const before = old.readPlacementsFile(text, 'tatooine', 'ground');
    const sk = before.skipped[0];
    ok(before.rows.length === 1 && before.rows[0].id === 'crate-1' && before.skipped.length === 1 && sk.id === 'hut-1' && /its pack is not props, gallery or world/.test(sk.why), `the reader before the wave skips the imported row and names it (${sk?.id}: "${sk?.why}"), reading every other`);
    ok(sha(JSON.stringify(before)) === BEFORE_WAVE_VERDICT, `and what it read is the answer recorded here for a machine where git cannot hand it over (${sha(JSON.stringify(before))})`);
    // Every placements file on disk, the owner's own as he edits them included: every row that is not an imported one reads
    // alike through both readers, and every imported one (which he may put down any day) is read today and skipped and named
    // before, in that reader's own words.
    let files = 0;
    let differ = '';
    let imported = 0;
    for (const layer of ['world', 'story']) {
      const dir = join(REPO, 'public', 'placements', layer);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const t = readFileSync(join(dir, f), 'utf8');
        const world = f.slice(0, -5);
        const kind = /^space_/.test(world) ? 'space' : 'ground';
        const a = readPlacementsFile(t, world, kind);
        const b = old.readPlacementsFile(t, world, kind);
        const ids = new Set(a.rows.filter((r) => r.pack === 'imported').map((r) => r.id));
        imported += ids.size;
        const theirs = (u: string) => ids.has(u.slice(0, u.lastIndexOf('.')));
        const rest = (r: typeof a, rows: typeof a.rows) => JSON.stringify({ rows, skipped: r.skipped.filter((s) => !ids.has(s.id)), unknown: r.unknown.filter((u) => !theirs(u)), problem: r.problem });
        const named = [...ids].every((id) => b.skipped.some((s) => s.id === id && /its pack is not props, gallery or world/.test(s.why)));
        files++;
        if ((rest(a, a.rows.filter((r) => !ids.has(r.id))) !== rest(b, b.rows) || !named) && !differ) differ = `${layer}/${f}`;
      }
    }
    ok(!differ, `every placements file on disk (${files}, ${imported} imported row${imported === 1 ? '' : 's'} among them) reads alike through today's reader and the one before the wave but for its imported rows, which that reader skips and names${differ ? `; not ${differ}` : ''}`);
  }
}

// ---- The library's Imported source: each folder's index, the shipped one's first. ----
{
  const { importEntries, LIBRARY_SOURCES, entryForRow, libraryView, usedHereKeys } = await import('../../../src/editor/libraryModel.ts');
  const shippedIdx = { entries: [{ id: 'shed', name: 'Shed', group: 'TEST', kind: 'prop', pic: 'icons/shed.11111111.png', sz: [2, 2, 2], tri: 12 }] };
  const privateIdx = { entries: [{ id: 'shed', name: 'Old shed', kind: 'prop' }, { id: 'hut', name: 'Hut', kind: 'building', pic: 'icons/hut.33333333.png' }, { id: 'Bad Id' }, { id: 'tree', kind: 'flora', pic: '../escape.png' }] };
  const taken = new Set<string>();
  const list = [...importEntries(shippedIdx, 'imports/', taken), ...importEntries(privateIdx, 'imports-private/', taken)];
  ok(LIBRARY_SOURCES.includes('imported'), 'the library lists an Imported source');
  ok(list.map((e) => `${e.p}/${e.id}`).join() === 'imports/shed,imports-private/hut,imports-private/tree', `the shipped folder's entries first, a private one under a shipped id left out, an id of no shape passed over (${list.map((e) => `${e.p}/${e.id}`).join(', ')})`);
  ok(list[0].pic === '/imports/icons/shed.11111111.png' && list[1].pic === '/imports-private/icons/hut.33333333.png' && list[2].pic === null, 'each picture named from its own folder, and one naming anything but an icon none');
  ok(list[1].f !== 0 && list[2].f !== 0 && list[0].f === 0 && list.every((e) => e.s === 'imported' && e.m === e.id), "a building and a flora model flagged as such, each entry's model its id");
  ok(importEntries(null, 'imports/').length === 0 && importEntries({ entries: 'no' }, 'imports/').length === 0, 'a folder with no index gives none: with no imports the library is as it was');
  const view = libraryView(list);
  const row = { pack: 'imported', model: 'hut' };
  ok(entryForRow(view, row, 'tatooine') === list[1] && entryForRow(view, { pack: 'imported', model: 'gone' }, 'tatooine') === null, 'a row of an imported model finds its entry by its id (the eyedropper, a hotbar slot)');
  ok(usedHereKeys(view, [row, row, { pack: 'imported', model: 'shed' }], 'tatooine').join() === 'imported:hut,imported:shed', 'and Used here counts it');
}

// ---- Reload imports' own halves, run: only the imported rows come down and stand again, and a pack let go is looked in no more. ----
{
  const h = await makeStreamer();
  const gen = { n: 1 };
  // What the world's `importsNow` would hand over: the folders as first read, then read again (a fresh pack, as the editor's
  // Reload imports reads both folders anew after letting the old ones go).
  let packsNow: { shipped: unknown; private: unknown } | null = packs;
  const asked: string[] = [];
  const layer = new PermanentLayer({
    stand: (row, g, key) => {
      const s = dressingStandOf(row, g, key, () => null, () => false);
      if (!s) return null;
      if (row.pack !== 'imported') return h.stream.standPermanent(s, h.gallery as never);
      const pack = importPackFor(packsNow as never, s.model) as { root: string } | null;
      if (pack) asked.push(pack.root);
      return pack ? h.stream.standPermanent(s, pack as never) : null;
    },
    unstand: (key) => void h.stream.unplace(key),
    unstandMany: (keys) => void h.stream.unplaceMany(keys),
    packReady: (pack) => pack !== 'imported' || !!packsNow,
    generation: () => gen.n,
    label: (row) => row.id,
  });
  layer.enter('tatooine', { x: 0, z: 0 }, 'ground', 1);
  const read = (rows: unknown[]) => readPlacementsFile(placementsFileText('tatooine', 'raw', rows as never), 'tatooine', 'ground');
  const hutRow = { id: 'hut-9', kind: 'prop', pack: 'imported', model: 'hut', x: -200, y: 0, z: 60, q: [1, 0, 0, 0] };
  const crateRow = { id: 'crate-9', kind: 'prop', pack: 'gallery', model: 'crate', x: -210, y: 0, z: 60, q: [1, 0, 0, 0] };
  await Promise.all(layer.setLayers(read([]), read([hutRow, crateRow])));
  await h.settle({ x: 205, z: 60 }, 40);
  const hutWas = h.s.placedByKey.get('place/hut-9');
  const crateWas = h.s.placedByKey.get('place/crate-9');
  ok(!!hutWas && !!crateWas && layer.count === 2 && h.s.fromPacks.includes(priv), 'reload: an imported row and a gallery row both stand, the imports pack standing behind the world for its row alone');
  const down = layer.takeDownWhere((r) => r.pack === 'imported');
  ok(down === 1 && !h.s.placedByKey.has('place/hut-9') && h.s.placedByKey.get('place/crate-9') === crateWas && layer.count === 1, `reload: taking the imported rows down takes down the imported row alone (${down}), the gallery row standing as it was`);
  h.stream.forgetPack(priv as never);
  h.stream.forgetPack(h.s.pack);
  ok(!h.s.fromPacks.includes(priv) && !h.s.guests.includes(priv) && ![...h.s.donorPacks.values()].includes(priv) && !!h.s.pack, "reload: the pack let go is forgotten by the streamer (no list of its looks in it again), and the world's own pack never is");
  // The folders read again: a fresh pack of the same models, and the row stood again out of it.
  const fresh = importsPack('imports-private/', [SHED_PRIVATE, HUT, OWN_CRATE], { shed: loadedOf(SHED_PRIVATE, [{ geometry: privateShedGeo, cell: -1 }]), hut: hutModel, crate: loadedOf(OWN_CRATE, [{ geometry: ownCrateGeo, cell: -1 }]) });
  packsNow = { shipped, private: fresh };
  await Promise.all(layer.resync());
  await h.settle({ x: 205, z: 60 }, 40);
  const hutNow = h.s.placedByKey.get('place/hut-9');
  ok(!!hutNow && hutNow !== hutWas && h.s.placedByKey.get('place/crate-9') === crateWas && layer.count === 2 && fresh.asked.includes('hut') && h.s.fromPacks.includes(fresh) && !h.s.fromPacks.includes(priv), 'reload: brought back to the files, the imported row stands again out of the pack read afresh, and the gallery row was never touched');
  // With no imports read yet the row waits for them, and a world that has gone stands nothing.
  layer.takeDownWhere((r) => r.pack === 'imported');
  packsNow = null;
  layer.resync();
  ok(!h.s.placedByKey.has('place/hut-9') && layer.report().rows.some((r) => r.id === 'hut-9' && !r.stood), 'reload: with the imports not yet answered the row waits, unstood and listed');
  gen.n = 2;
  ok(layer.takeDownWhere(() => true) === 0 && layer.resync().length === 0, 'reload: and for a world that has gone, nothing comes down and nothing stands');
}

// ---- The dev server's imports folders answer only files inside them (`servedFile`, which vite.config.ts's middlewares use). ----
{
  const dir = resolve(REPO, 'imports-private');
  ok(servedFile(dir, '/icons/a.png') === join(dir, 'icons', 'a.png') && servedFile(dir, '/manifest.json?v=2') === join(dir, 'manifest.json') && servedFile(dir, '/my%20house.1234abcd.glb') === join(dir, 'my house.1234abcd.glb'), 'a file inside the folder is answered by its path, decoded, its query left off');
  const outside = ['/../.env', '/%2e%2e/.env', '/icons/../../package.json', '/..%2f..%2fpackage.json', '/..\\..\\package.json', '/', '', '/%E0%A4%A', '/a%00b'];
  ok(outside.every((u) => servedFile(dir, u) === null), `nothing outside the folder, the folder itself, a path that does not decode or one holding a nought (${outside.map((u) => JSON.stringify(u)).join(', ')})`);
  ok(outside.every((u) => { const f = servedFile(dir, u); return f === null || f.startsWith(dir + sep); }), 'so no file the middleware opens is outside it');
}

// ---- The hand-overs only the game makes, read as text (every behaviour above builds its own). ----
{
  const text = (f: string) => readFileSync(join(REPO, f), 'utf8').split(/\r?\n/);
  const has = (f: string, line: string) => text(f).some((l) => l.trim() === line);
  /** Whether `lines` stand one after another in a file, each whole once trimmed. */
  const follows = (f: string, lines: string[]) => {
    const t = text(f).map((l) => l.trim());
    return t.some((_, i) => lines.every((l, k) => t[i + k] === l));
  };
  const main = text('src/main.ts');
  ok(has('src/main.ts', "packReady: (pack, from) => (pack === 'props' ? !!this.props.pack : pack === 'gallery' ? !!this.dressingGallery : pack === 'imported' ? !!this.world.importsNow : !!this.world.placeFrame && (!from || !!this.world.guestWorldNow(from))),"), "an imported row is ready once the imports' two packs have answered");
  ok(follows('src/main.ts', ["if (rows.some((r) => r.pack === 'imported')) {", 'await this.world.importsPack();', 'for (const r of rows) {', "if (r.pack !== 'imported' || !r.model) continue;", 'for (const m of readLooks(this.world.importPackOf(r.model)?.find(r.model)?.looks) ?? []) {']), "an arrival with an imported row among its rows loads both imports folders (the only load an arrival makes) and lends their models' borrowed pictures' packs as donors");
  ok(follows('src/main.ts', ["if (row.pack === 'imported') {", 'const pack = this.world.importPackOf(s.model);', 'return pack ? this.world.standPlacement(s, pack) : null;', '}']), 'and an imported row stands out of the pack `importPackOf` names, the shipped folder first, or not at all');
  const reload = main.slice(main.findIndex((l) => l.includes('private async editorReloadImports')));
  const at = (s: string) => reload.findIndex((l) => l.includes(s));
  const order = ['this.permanent.takeDownWhere(imported)', 'this.world.refilePlaced(ls.filing, { force: true })', 'this.world.releaseImports()', 'await this.world.importsPack()', 'await this.dressingPacks(', 'this.permanent.resync()'].map(at);
  ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])) && order[order.length - 1] < 25, `Reload imports takes the rows down, files the tiers again, lets the packs go, reads both folders, then stands the rows again, in that order (${order.join(', ')})`);
  ok(has('src/world/world.ts', 'this.releaseImports();') && has('src/world/world.ts', 'return importPackFor(this.importsReady, model);'), "the world lets the imports go with it, and asks `importPackFor` for a row's pack");
  ok(follows('src/world/world.ts', ['const asked = (this.importsAsk = {});', 'const ask = importsAsks(import.meta.env.DEV);']) && has('src/world/world.ts', 'this.imports = Promise.all([load(IMPORTS_SHIPPED, ask.shipped), load(IMPORTS_PRIVATE, ask.private)]).then(([shipped, priv]) => {') && follows('src/world/world.ts', ['if (this.importsAsk !== asked) {', 'this.releaseGuest(shipped);', 'this.releaseGuest(priv);', 'return { shipped: null, private: null };']), "the world asks the folders `importsAsks` names (the private one on the dev server alone), and lets go imports that land for a world gone or a reload since");
  ok(follows('src/world/world.ts', ['forgetImportCards(Object.values(p.manifest.categories).flatMap((list) => (Array.isArray(list) ? list.map((d) => d.id) : [])));', 'this.layoutStream?.forgetPack(p);', 'this.releaseGuest(p);']), "letting the imports go forgets their models' leaves by name, and the streamer the pack, before the pack is let go");
  ok(has('src/world/assetPack.ts', 'prepareSwayModel(scenes, `${this.baseUrl}${this.imported ? def.file : def.id}`, def.id, { flora, building: !!def.cells?.length });'), "an imported model is measured for the sway under its made file's name, every converted model under its id as before");
  ok(follows('vite.config.ts', ["name: 'private-imports',", "apply: 'serve',"]) && has('vite.config.ts', 'const file = servedFile(IMPORTS_DIR, req.url);') && has('vite.config.ts', 'const file = servedFile(SHIPPED_IMPORTS_DIR, req.url);') && has('vite.config.ts', "if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {"), 'the imports middlewares are the dev server\'s alone and open only what `servedFile` answers');
  ok(has('src/world/world.ts', 'if (takesNormalScale(m)) std.normalScale.y *= normalYOf(m);') && has('src/world/world.ts', 'std.normalScale.y *= normalYOf(std);'), "the world's normal override takes an import's marker, at adoption and when the override moves");
  ok(has('src/world/layoutStream.ts', 'for (const prim of model.colliderOnly ? [...model.primitives, ...model.colliderOnly] : model.primitives) {') && has('src/world/layoutStream.ts', 'if (prim.material.userData.swgNoCollide === true) continue;'), "the streamer's colliders take the stand-ins and step over a -nocol piece");
  ok(has('vite.config.ts', 'plugins: [privateAssets(), privateStory(), privateImports(), placementFiles(), placementsEditor(), trackFiles(), tracksEditor(), shippedPublicList()],'), 'the imports plugin is in, and the shipped list stays the last plugin');
  ok(text('.gitignore').some((l) => l.trim() === 'imports-private' || l.trim() === 'imports-private/' || l.trim() === '/imports-private'), 'imports-private is git-ignored');
  ok(/'imports'/.test(readFileSync(join(REPO, 'tools', 'dev', 'shippedPublic.mjs'), 'utf8')), "public/imports is among the shipped public folders a build lists");
}

console.log(`\nimportsStand: ${checks} checks passed`);
