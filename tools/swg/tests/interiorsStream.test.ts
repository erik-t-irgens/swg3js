// The client's own furniture in its buildings' rooms, on the real streamer and the real physics (`streamHarness.ts`):
// a layout's pieces (`furnishLayout`) are filed in their building's rooms and hosted by it, solid by the world's rule and a
// seat never; a post the data put inside a solid piece is moved clear of it on the room's own floor (`clearPost`), a post
// beside one is left where it is, a piece whose model is known not to load holds nobody and one still to come holds the
// answer back; which building's rooms hold a point (`hostKeyAt`); a piece only the props folder carries is filed, loaded
// and made solid out of the pack standing behind the world (`guests`); a permanent row is filed at its own radius only where
// it carries one; and a world whose pack carries no interiors file stands, draws and collides exactly as the streamer did at
// the wave's start (5f3be48, loaded out of git), with its permanent rows.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The harness first: it stands a stub in for the particle player before anything loads the streamer.
const { makeStreamer, loadedOf, boxGeo, INDOOR_FILTER, THREE } = await import('./streamHarness.ts');
const { collidesByRule } = await import('../../../src/world/layoutStream.ts');
const { furnishLayout, FURNITURE_RADIUS, POST_CLEAR_TUNE, insidePiece } = await import('../../../src/world/interiors.ts');
const { isSeat, isTableTemplate } = await import('../../../src/world/rowSolid.ts');
const { modelTier, snapshotTier } = await import('../../../src/world/placedTiers.ts');

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
/** The wave's start (main when the interior layout files' wave began). */
const BASE = '5f3be48';
/**
 * The SHA-1 of what that streamer draws and files over the layout below, settled (`trace`), worked out from the streamer
 * loaded out of git at `BASE`: what today's is held to where git cannot hand the old one over.
 */
const BASE_TRACE = '2e25bf1bd5999d8750a38dc0a62647e5f1fa7ebf';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

/** A hall of the world's own, its one room's floor 0.3 m up, which the nav's reader reads (a bare three a triangle). */
const FLOOR = { v: [[-9, 0.3, -9], [9, 0.3, -9], [9, 0.3, 9], [-9, 0.3, 9]], t: [[0, 1, 2], [0, 2, 3]], stride: 3 };
const WHALL = {
  id: 'whall',
  file: 'whall.glb',
  bounds: { min: [-10, -16, -10], max: [10, 8, 10] },
  triangles: 24,
  cells: [
    { index: 0, name: 'r0', bounds: { min: [-10, -16, -10], max: [10, 8, 10] }, portals: [{ geometry: 0, target: 1, passable: true }] },
    { index: 1, name: 'r1', bounds: { min: [-9, 0, -9], max: [9, 7.5, 9] }, portals: [{ geometry: 0, target: 0, passable: true }], floor: FLOOR },
  ],
  portals: [{ v: [[-1, 0, 10], [1, 0, 10], [1, 2, 10], [-1, 2, 10]], i: [0, 1, 2, 0, 2, 3] }],
};
/** A chest 1.2 m across and a metre high, its mesh in its scene (what a post is tested against). */
const CHEST = { id: 'chest', file: 'chest.glb', bounds: { min: [-0.6, 0, -0.6], max: [0.6, 1, 0.6] }, triangles: 12 };
function chestModel() {
  const m = loadedOf(CHEST, [{ geometry: boxGeo(1.2, 1, 1.2, 0), cell: -1 }]);
  m.scene.add(new THREE.Mesh(boxGeo(1.2, 1, 1.2, 0), new THREE.MeshStandardMaterial()));
  return m;
}
function hallModel() {
  const room = [new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 7.5, 9))];
  return loadedOf(WHALL as never, [{ geometry: boxGeo(20, 8, 20, 0), cell: 0 }, { geometry: boxGeo(18, 0.3, 18, 0), cell: 1 }], room);
}
const HALL_T = 'object/building/test/shared_whall.iff';
const CHAIR_T = 'object/tangible/furniture/all/shared_frn_all_chair_s01.iff';
const CHEST_T = 'object/tangible/furniture/all/shared_frn_all_chest_s01.iff';
/** The hall at the game's (50, 0, 50): the snapshot's x is mirrored about the centre, nought here. */
const HALL_AT = { x: 50, z: 50 };
const HALL_OBJECT = { template: HALL_T, model: 'whall', x: -HALL_AT.x, y: 0, z: HALL_AT.z, q: [1, 0, 0, 0], radius: 40 };
const FILE = {
  version: 1,
  templates: {
    [HALL_T]: {
      file: 'interiorlayout/whall.ilf',
      model: 'whall',
      pieces: [
        // The chest a metre along the room's -X (the snapshot's +X: the game mirrors X), a chair across the room, a sound.
        [0, CHEST_T, 'chest', 'own', 1, 1, 0.3, 1, 1, 0, 0, 0],
        [1, CHAIR_T, 'crate', 'own', 1, -3, 0.3, -3, 1, 0, 0, 0],
        [2, 'object/soundobject/shared_soundobject_cantina_large.iff', '', 'snd', 1, 0, 2, 0, 1, 0, 0, 0],
        [3, 'object/tangible/furniture/all/shared_frn_all_ghost_s01.iff', 'ghost', 'own', 1, 4, 0.3, 4, 1, 0, 0, 0],
        // A ring of counter: its box holds its middle, its mesh does not (a bartender stands in there).
        [4, 'object/tangible/furniture/all/shared_frn_all_bar_ring_s01.iff', 'ring', 'own', 1, 5, 0.3, -4, 1, 0, 0, 0],
        // A table: passable, and nobody stands in it.
        [5, 'object/tangible/furniture/all/shared_frn_all_table_s01.iff', 'chest', 'own', 1, -4, 0.3, 4, 1, 0, 0, 0],
      ],
    },
  },
  buildings: [{ row: 0, key: `o:${HALL_T}@-50,0,50`, template: HALL_T }],
  defs: [],
};
const GHOST = { id: 'ghost', file: 'ghost.glb', bounds: { min: [-0.6, 0, -0.6], max: [0.6, 1, 0.6] }, triangles: 12 };
/** A ring of counter 4 m across: four walls 0.2 m thick round an open middle. */
const RING = { id: 'ring', file: 'ring.glb', bounds: { min: [-2, 0, -2], max: [2, 1.1, 2] }, triangles: 48 };
function ringModel() {
  const walls = [
    [0, 1.9, 4, 0.2],
    [0, -1.9, 4, 0.2],
    [1.9, 0, 0.2, 4],
    [-1.9, 0, 0.2, 4],
  ].map(([x, z, w, d]) => {
    const g = boxGeo(w, 1.1, d, 0);
    g.translate(x, 0, z);
    return g;
  });
  const m = loadedOf(RING, walls.map((geometry) => ({ geometry, cell: -1 })));
  for (const g of walls) m.scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
  return m;
}

// ---- 1. A layout's pieces, filed in their building's rooms. ----
const pieces = furnishLayout([HALL_OBJECT] as never, FILE as never);
ok(pieces.objects.length === 5 && pieces.sounds === 1, 'the file stands the chest, the chair, the ghost, the ring and the table; the sound object is the placed sounds\'');
const h = await makeStreamer([HALL_OBJECT, ...pieces.objects] as never, { defs: [WHALL as never, CHEST, GHOST, RING], models: { whall: hallModel(), chest: chestModel(), ring: ringModel() } });
await h.settle(HALL_AT, 30);
const hall = h.s.objects.find((o: { template: string }) => o.template === HALL_T);
const chest = h.s.objects.find((o: { ilf?: string }) => o.ilf?.endsWith('/0'));
const chair = h.s.objects.find((o: { ilf?: string }) => o.ilf?.endsWith('/1'));
ok(!!hall && !!chest && !!chair, 'the hall and its pieces are filed');
ok(chest.host === hall && chair.host === hall && chest.contained && chest.radius === FURNITURE_RADIUS, "each piece is hosted by its building, drawn with its rooms (the snapshot's own path)");
ok(Math.abs(chest.x - (HALL_AT.x - 1)) < 1e-9 && Math.abs(chest.z - (HALL_AT.z + 1)) < 1e-9 && Math.abs(chest.y - 0.3) < 1e-9, `at its place carried into the game's frame (${chest.x}, ${chest.y}, ${chest.z})`);
ok(chest.ilf === `o:${HALL_T}@-50,0,50/0`, `known by its building's key and index (${chest.ilf})`);
ok(collidesByRule(chest) && !collidesByRule(chair), 'the chest is solid (the snapshot\'s own least radius for a contained thing), the chair never');
const top = h.rayDown(chest.x, chest.z, 6, INDOOR_FILTER);
const under = h.rayDown(chair.x, chair.z, 6, INDOOR_FILTER);
ok(top !== null && Math.abs(top - 1.3) < 0.02, `the chest stands solid on the floor: a ray down meets its top at ${top?.toFixed(2)}`);
ok(under !== null && Math.abs(under - 0.3) < 0.02, `a ray down through the chair meets the floor (${under?.toFixed(2)})`);
// Which building's rooms hold a point, by the very rule a thing put down there is hosted (`hostKeyAt`): what a building whose
// furniture is its own carries, a mark (which nothing files) as much as a prop.
ok(h.stream.hostKeyAt(chest.x, 0.5, chest.z) === HALL_T && h.stream.hostKeyAt(HALL_AT.x + 8.5, 3, HALL_AT.z - 8.5) === HALL_T, "a point in the hall's room, in the middle or near its wall, is the hall's");
ok(h.stream.hostKeyAt(HALL_AT.x + 30, 0.5, HALL_AT.z) === null && h.stream.hostKeyAt(HALL_AT.x, 40, HALL_AT.z) === null, 'one outside it, beside it or over its roof, is nobody\'s');
{
  // What the seats of ours and the people of ours ask for the furniture round a point (`World.dataPlacedNear`, the
  // fillers' `furnish`): the contained objects near it, a game template each. A piece is one of them, so no chair of ours
  // stands where the game's does and the seated sit on the game's.
  const near: { template: string; ilf?: string }[] = [];
  h.stream.containedNear(chair.x, chair.z, 1, near);
  const seat = near.find((o) => o.ilf === chair.ilf);
  ok(!!seat && seat.template.startsWith('object/') && isSeat(seat.template), `the chair piece is found round its place as the game's own seat (${seat?.template})`);
  const table = h.s.objects.find((o: { ilf?: string }) => o.ilf?.endsWith('/5'));
  h.stream.containedNear(table.x, table.z, 1, near);
  ok(near.some((o) => o.ilf === table.ilf && isTableTemplate(o.template)), 'and the table piece as the game\'s own table');
}

// ---- 2. A post inside a solid piece, moved clear on its room's floor. ----
{
  const st = { x: chest.x + 0.1, y: 0.3, z: chest.z - 0.1, room: 1 };
  const moved = h.stream.clearPost(st);
  const box = { x: chest.x, y: chest.y, z: chest.z, qx: chest.q.x, qy: chest.q.y, qz: chest.q.z, qw: chest.q.w, min: CHEST.bounds.min, max: CHEST.bounds.max };
  ok(moved === true && !insidePiece(box, st.x, st.y, st.z, POST_CLEAR_TUNE.body - 1e-9), `a post inside the chest is moved clear of it by a body's width (to ${st.x.toFixed(2)}, ${st.z.toFixed(2)})`);
  ok(Math.abs(st.y - 0.3) < 1e-6 && Math.abs(st.x - HALL_AT.x) <= 9 && Math.abs(st.z - HALL_AT.z) <= 9, 'on the same room\'s floor, never out of it');
  ok(Math.hypot(st.x - chest.x, st.z - chest.z) < 1.6, `and near (${Math.hypot(st.x - chest.x, st.z - chest.z).toFixed(2)} m from the chest's middle)`);
  const beside = { x: chest.x + 2, y: 0.3, z: chest.z, room: 1 };
  ok(h.stream.clearPost(beside) === false && beside.x === chest.x + 2, 'a post beside it stands where it is');
  const onChair = { x: chair.x, y: 0.3, z: chair.z, room: 1 };
  ok(h.stream.clearPost(onChair) === false, 'a post on a seat is never moved (a seat is no solid piece)');
  const table = h.s.objects.find((o: { ilf?: string }) => o.ilf?.endsWith('/5'));
  const inTable = { x: table.x + 0.1, y: 0.3, z: table.z, room: 1 };
  ok(!collidesByRule(table) && h.stream.clearPost(inTable) === true && Math.hypot(inTable.x - table.x, inTable.z - table.z) > 0.6, `a table is passable (the seated are never pushed off it) and still nobody stands inside one: moved to ${Math.hypot(inTable.x - table.x, inTable.z - table.z).toFixed(2)} m from its middle`);
  const ring = h.s.objects.find((o: { ilf?: string }) => o.ilf?.endsWith('/4'));
  const inRing = { x: ring.x, y: 0.3, z: ring.z, room: 1 };
  const ringBox = { x: ring.x, y: ring.y, z: ring.z, qx: 0, qy: 0, qz: 0, qw: 1, min: RING.bounds.min, max: RING.bounds.max };
  ok(insidePiece(ringBox, inRing.x, inRing.y, inRing.z, 0) && h.stream.clearPost(inRing) === false && inRing.x === ring.x, "a post inside a ring of counter's box but on its open floor stays where the data put it (the line down meets no counter)");
  const ghost = h.s.objects.find((o: { ilf?: string }) => o.ilf?.endsWith('/3'));
  const inGhost = { x: ghost.x, y: 0.3, z: ghost.z, room: 1 };
  // Its tier asked for the ghost's model as it was built, and the pack has none: known to have failed.
  ok(h.stream.hasFailed('ghost'), 'the ghost piece was asked to load with its tier and failed');
  const answer = h.stream.clearPost(inGhost);
  ok(answer === false && inGhost.x === ghost.x, `a piece whose model is known not to load holds nobody for good, rather than holding the post waiting for ever (${answer})`);
  // One whose model is still to come is waited for: a piece of a model nobody has asked for yet holds the post's answer back.
  h.s.failed.delete('ghost');
  const waiting = h.stream.clearPost({ x: ghost.x, y: 0.3, z: ghost.z, room: 1 });
  ok(waiting === null, `and a piece whose model has not loaded and has not failed makes the post wait (${waiting})`);
  h.s.failed.add('ghost');
}

// ---- 3. Which building put down in play holds a point, and a row's own radius. ----
{
  await h.stream.place({ model: 'hall', template: 'place/house', x: -150, y: 0, z: 150, q: new THREE.Quaternion(), radius: 14, solid: true });
  await h.put('place/house.f0', 'crate', -152, 152, { inside: true });
  ok(h.stream.hostKeyAt(-152, 0.5, 152) === 'place/house' && h.stream.hostKeyAt(-148, 6, 148) === 'place/house', 'a building put down in play holds the points in its rooms, a piece of its furniture standing there and a mark hung under its ceiling alike');
  ok(h.stream.hostKeyAt(-130, 0.5, 150) === null, 'and none outside them');
  h.stream.unplace('place/house');
  ok(h.stream.hostKeyAt(-152, 0.5, 152) === null, 'taken down, it holds nothing');
  await h.stream.place({ model: 'hall', template: 'place/house', x: -150, y: 0, z: 150, q: new THREE.Quaternion(), radius: 14, solid: true });
  const a = h.stream.standPermanent({ key: 'place/r1', model: 'crate', x: -170, y: 0, z: 170, q: [0, 0, 0, 1], inside: false } as never, h.gallery as never);
  const b = h.stream.standPermanent({ key: 'place/r2', model: 'crate', x: -172, y: 0, z: 170, q: [0, 0, 0, 1], inside: false, radius: FURNITURE_RADIUS } as never, h.gallery as never);
  ok(!!a && !!b && h.s.placedByKey.get('place/r1').radius === 0.5 && h.s.placedByKey.get('place/r2').radius === FURNITURE_RADIUS, 'a permanent row is filed at its box\'s radius as always, and at its own only where it carries one');
}

// ---- 3b. A piece whose model only the props folder carries: the furniture pack standing behind the world. ----
{
  // The world's own pack has no `cask`; the pack over the props folder (`World.furniturePack`, handed to the streamer as a
  // guest from its making) does. Filed by its own model's size, loaded out of that pack, and solid on the hall's floor.
  const CASK_T = 'object/tangible/furniture/all/shared_frn_all_cask_s01.iff';
  const CASK = { id: 'cask', file: 'cask.glb', bounds: { min: [-0.4, 0, -0.4], max: [0.4, 0.9, 0.4] }, triangles: 12 };
  const caskModel = () => {
    const m = loadedOf(CASK, [{ geometry: boxGeo(0.8, 0.9, 0.8, 0), cell: -1 }]);
    m.scene.add(new THREE.Mesh(boxGeo(0.8, 0.9, 0.8, 0), new THREE.MeshStandardMaterial()));
    return m;
  };
  const file = { ...FILE, templates: { [HALL_T]: { file: 'interiorlayout/whall.ilf', model: 'whall', pieces: [[0, CASK_T, 'cask', 'props', 1, 2, 0.3, 2, 1, 0, 0, 0]] } } };
  const made = furnishLayout([HALL_OBJECT] as never, file as never);
  const g = await makeStreamer([HALL_OBJECT, ...made.objects] as never, { defs: [WHALL as never], models: { whall: hallModel() }, guests: [{ planet: 'interiors', defs: [CASK], models: { cask: caskModel() } }] });
  await g.settle(HALL_AT, 30);
  const cask = g.s.objects.find((o: { ilf?: string }) => o.ilf?.endsWith('/0'));
  const byModel = modelTier(FURNITURE_RADIUS, CASK.bounds);
  ok(byModel !== snapshotTier(FURNITURE_RADIUS), `(the check means something: its model's tier ${byModel} is not its radius's ${snapshotTier(FURNITURE_RADIUS)})`);
  ok(!!cask && cask.sizeTier === byModel, `a piece the world's pack does not carry is filed by its model's own size, read off the pack behind it (tier ${cask?.sizeTier})`);
  ok(!g.stream.hasFailed('cask') && !!g.s.loadedOf('cask', cask.pack), 'and loaded out of that pack');
  const top = g.rayDown(cask.x, cask.z, 6, INDOOR_FILTER);
  ok(top !== null && Math.abs(top - 1.2) < 0.02, `and solid on the floor: a ray down meets its top at ${top?.toFixed(2)}`);
}

// ---- 4. With no interiors file, the world is the wave's start's. ----
{
  const objects = [
    { template: 'object/rock', model: 'rock', x: -100, y: 0, z: 100, q: [1, 0, 0, 0], radius: 40 },
    HALL_OBJECT,
    { template: CHEST_T, model: 'chest', x: -51, y: 0.3, z: 51, q: [1, 0, 0, 0], radius: 32, contained: true, cell: 1, in: 1 },
    { template: 'object/crate', model: 'crate', x: -40, y: 0, z: 40, q: [1, 0, 0, 0], radius: 1 },
  ];
  async function baseStreamer(): Promise<(new (...args: any[]) => any) | null> {
    const files = ['src/world/layoutStream.ts', 'src/world/levelGroup.ts'];
    const texts = new Map<string, string>();
    try {
      for (const f of files) texts.set(f, execFileSync('git', ['show', `${BASE}:${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'));
    } catch {
      return null;
    }
    const dir = mkdtempSync(join(tmpdir(), 'ilf-base-'));
    const three = import.meta.resolve('three');
    try {
      for (const f of files) {
        const from = resolve(REPO, f, '..');
        const text = texts.get(f)!.replace(/from 'three'/g, `from '${three}'`).replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => {
          const target = resolve(from, p).replace(/\\/g, '/');
          const own = files.find((x) => resolve(REPO, x).replace(/\\/g, '/') === target);
          return `from '${own ? pathToFileURL(join(dir, own.split('/').pop()!)).href : pathToFileURL(resolve(from, p)).href}'`;
        });
        writeFileSync(join(dir, f.split('/').pop()!), text);
      }
      const mod = await import(pathToFileURL(join(dir, 'layoutStream.ts')).href);
      return mod.LayoutStreamer;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  type H = Awaited<ReturnType<typeof makeStreamer>>;
  const picture = (x: H): string[] =>
    x.scene.children.map((c) => {
      const m = c as THREE.InstancedMesh;
      return [c.type, m.isInstancedMesh ? m.count : -1, m.isInstancedMesh ? Array.from(m.instanceMatrix.array as Float32Array, (v) => v.toFixed(5)).join(',') : '', m.geometry?.getAttribute('position')?.count ?? -1, c.visible, m.castShadow, m.receiveShadow, c.layers.mask, c.renderOrder].join('|');
    });
  const filed = (x: H): string[] =>
    x.s.objects.map((o: any) => [o.template, o.model, o.x, o.y, o.z, o.q.x, o.q.y, o.q.z, o.q.w, o.radius, o.contained, String(o.solid), o.tier, o.host?.template ?? '', o.footprint].join('|'));
  const trace = async (x: H) => {
    // A permanent row of each kind, stood as the permanent layer stands it.
    x.stream.standPermanent({ key: 'place/c1', model: 'crate', x: 60, y: 0, z: 60, q: [0, 0, 0, 1], inside: false, solid: true } as never, x.gallery as never);
    x.stream.standPermanent({ key: 'place/h1', model: 'hall', x: 140, y: 0, z: 40, q: [0, 0, 0, 1], inside: false, solid: true } as never, x.gallery as never);
    await x.settle({ x: 60, z: 60 }, 30);
    const rays = [x.rayDown(50, 50, 6, INDOOR_FILTER), x.rayDown(51, 51, 6, INDOOR_FILTER), x.rayDown(60, 60), x.rayDown(100, 100, 40)];
    return [...picture(x), '-- filed --', ...filed(x), '-- rays --', rays.map((r) => (r === null ? 'none' : r.toFixed(4))).join(','), `${x.s.loadedInstances}:${x.s.loadedModels}`].join('\n');
  };
  const extra = { defs: [WHALL as never, CHEST], models: { whall: hallModel(), chest: chestModel() } };
  const now = await trace(await makeStreamer(objects as never, extra));
  const sha = createHash('sha1').update(now).digest('hex');
  const Base = await baseStreamer();
  if (!Base) {
    if (BASE_TRACE) ok(sha === BASE_TRACE, `with no interiors file the streamer's scene, filing and collisions hash to ${BASE}'s own (written in; git could not hand it over): ${sha}`);
    else note(`git could not hand ${BASE}'s streamer over and no trace is written in: ${sha}`);
  } else {
    const then = await trace(await makeStreamer(objects as never, { ...extra, models: { whall: hallModel(), chest: chestModel() }, Streamer: Base }));
    const a = now.split('\n');
    const b = then.split('\n');
    const first = a.findIndex((l, i) => l !== b[i]);
    ok(now === then, `with no interiors file, every mesh, its matrices, every object filed (place, turn, radius, room, solid, tier, host) and what a ray meets are ${BASE}'s (${a.length} lines${first >= 0 ? `; first differs at ${first}: ${a[first]} / ${b[first]}` : ''})`);
    if (BASE_TRACE) ok(createHash('sha1').update(then).digest('hex') === BASE_TRACE, `and the hash written in is ${BASE}'s own trace`);
    else note(`${BASE}'s trace hashes to ${createHash('sha1').update(then).digest('hex')}`);
  }
}

console.log(`\n${checks} checks passed`);
