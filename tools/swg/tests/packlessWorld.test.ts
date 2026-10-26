// The real-elevation worlds stand things (DESIGN.md §2.13): a ground world that says it has no pack (`pack: false`, never
// a converted world whose pack is missing or failed, whose rows are written about its own centre) gets a stand-in pack (no models of its
// own, nothing fetched) and an empty layout about (0, 0), with the real streamer made over them as the layout block makes
// one, so a props row and a gallery building stand through `standPermanent`, mirrored about (0, 0) as every raw row is.
// `World.placeFrame` answers (0, 0) there and the layout's centre on a converted world, and `layoutCenter` still reads the
// pack's layout (5a4e765's text), since fifty-five readers take it to mean converted content.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { boxGeo, loadedOf, makeStreamer, THREE } from './streamHarness.ts';

const { dressingStandOf } = await import('../../../src/world/permanent.ts');
const { toGame } = await import('../../../src/story/placements.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

const h = await makeStreamer([]);
const Streamer = h.stream.constructor as new (...a: unknown[]) => typeof h.stream;
const scene = new THREE.Scene();
// The stand-in, as `World.standInStreamer` makes it: a pack with no models, an empty layout about (0, 0).
let asked = 0;
const standIn = {
  manifest: { planet: 'monument', categories: {} },
  root: '/assets-private/monument/',
  objectEffects: null,
  doors: null,
  find: () => undefined,
  isFlora: () => false,
  loaded: () => null,
  model: async (id: string) => {
    asked++;
    throw new Error(`the stand-in has no ${id}`);
  },
};
const layout = { planet: 'monument', center: { x: 0, z: 0 }, radius: 0, objects: [] };
const stream = new Streamer(scene, h.physics, standIn, layout, null, {});

// The props pack, as the catalogue mints it.
const CHAIR = { id: 'chair', file: 'chair.glb', bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, triangles: 12 };
const chairGeo = boxGeo(1, 1, 1, 0);
const chairModel = loadedOf(CHAIR, [{ geometry: chairGeo, cell: -1 }]);
const ready = new Map<string, unknown>();
const props = {
  manifest: { planet: 'props', categories: { layout: [CHAIR] } },
  root: '/assets-private/props/',
  objectEffects: null,
  doors: null,
  find: (id: string) => (id === 'chair' ? CHAIR : undefined),
  isFlora: () => false,
  loaded: (id: string) => ready.get(id) ?? null,
  model: async () => {
    ready.set('chair', chairModel);
    return chairModel;
  },
};

const at = new THREE.Vector3();
async function settle(x: number, z: number, n = 40): Promise<void> {
  for (let i = 0; i < n; i++) {
    stream.update(at.set(x, 0, z));
    await new Promise((r) => setTimeout(r, 0));
    h.physics.stepOnce();
  }
}
const m = new THREE.Matrix4();
const v = new THREE.Vector3();
function meshesAt(x: number, z: number): number {
  let n = 0;
  for (const c of scene.children) {
    const mesh = c as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      if (Math.abs(v.x - x) < 0.01 && Math.abs(v.z - z) < 0.01) n++;
    }
  }
  return n;
}

{
  const row = { id: 'chair-1', kind: 'prop', pack: 'props', thing: 'chair', x: 12, y: 0, z: 7, q: [1, 0, 0, 0] };
  const g = toGame(row as never, { x: 0, z: 0 }, 'raw');
  ok(g.x === -12 && g.z === 7, 'a raw row is mirrored about (0, 0), the frame /loc prints on such a world');
  const s = dressingStandOf(row as never, g, 'place/chair-1', () => ({ model: 'chair', template: 'object/tangible/furniture/shared_test_chair.iff' }), () => false);
  const answer = stream.standPermanent(s!, props as never);
  await settle(g.x, g.z);
  await answer?.built;
  ok(!!answer && meshesAt(-12, 7) === 1, 'a props row stands through the stand-in streamer');
  ok(asked === 0, 'and nothing was asked of the stand-in pack');
}
{
  const row = { id: 'house-1', kind: 'building', pack: 'gallery', model: 'house', x: 40, y: 0, z: -20, q: [1, 0, 0, 0] };
  const g = toGame(row as never, { x: 0, z: 0 }, 'raw');
  const s = dressingStandOf(row as never, g, 'place/house-1', () => null, () => false);
  const answer = stream.standPermanent(s!, h.gallery as never);
  await settle(g.x, g.z, 60);
  await answer?.built;
  await settle(g.x, g.z, 6);
  ok(!!answer && meshesAt(-40, -20) >= 1, 'a gallery building stands there too, at (-40, -20)');
  ok(stream.placedOf('place/house-1') !== null && asked === 0, 'filed under its key, still nothing asked of the stand-in');
}

{
  const world = readFileSync(join(root, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/get placeFrame\(\): \{ x: number; z: number \} \| null \{\s*return this\.layoutCenter \?\? this\.placeStandIn;/.test(world), '`placeFrame` answers the layout\'s centre on a converted world, and the stand-in\'s (0, 0) otherwise');
  ok(/this\.placeStandIn = \{ x: 0, z: 0 \};/.test(world) && /AssetPack\.from\(\{ planet: id, categories: \{\} \}, base\)/.test(world), 'the stand-in is a pack made in memory (nothing fetched) about (0, 0)');
  const getter = (t: string) => {
    const a = t.indexOf('  get layoutCenter(): { x: number; z: number } | null {');
    return a < 0 ? null : t.slice(a, t.indexOf('\n  }\n', a));
  };
  let old: string | null = null;
  try {
    old = execFileSync('git', ['--no-optional-locks', 'show', '5a4e765:src/world/world.ts'], { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20 }).replace(/\r\n/g, '\n');
  } catch {
    old = null;
  }
  // Where git cannot answer (a shallow or archived checkout), the getter is held to the hash of 5a4e765's own, written
  // here once out of git (line endings folded to LF), never skipped.
  const PRE_PASS_GETTER = '348d451980d8316fdf7be43180a1a885a68b83b43bc930373d4a62f9e0d83b03';
  const hash = (s: string | null) => (s === null ? '' : createHash('sha256').update(s).digest('hex'));
  if (old) ok(getter(world) !== null && getter(world) === getter(old) && hash(getter(old)) === PRE_PASS_GETTER, "`layoutCenter` still reads the pack's layout, 5a4e765's getter to the character");
  else ok(hash(getter(world)) === PRE_PASS_GETTER, "`layoutCenter` still reads the pack's layout, 5a4e765's getter to the character (held to its hash: git could not show 5a4e765)");
  ok(/if \(planet\.pack === false && !planet\.space && !this\.sceneOnly\) await this\.standInStreamer\(planet\.id, opts\.keepOff, token\);/.test(world), 'only a world that says it has no pack (`pack: false`, the real-elevation worlds) gets the stand-in: never space, the copies, the gallery, or a converted world whose pack is missing or failed');
}
{
  // Which worlds those are: the planet list's own word, never a pack that failed to load.
  const { PLANETS } = await import('../../../src/data/planets.ts');
  const packless = (PLANETS as readonly { id: string; pack?: false; space?: unknown }[]).filter((p) => p.pack === false);
  ok(packless.length >= 1 && packless.every((p) => !p.space), `the worlds that say they have no pack are ground worlds (${packless.map((p) => p.id).join(', ')})`);
  ok(!packless.some((p) => p.id === 'tatooine' || p.id === 'naboo' || p.id === 'corellia'), 'and no converted world is among them');
}

console.log(`\n${checks} checks passed`);
