// A standing chunk's ground written again in place (Map-maker II, DESIGN.md §2.4, `groundRewrite.ts`, `Terrain.rewriteChunk`):
// after a height edit, the rewrite equals `buildChunk` after the edit by `Object.is` over every attribute, the index and the
// heightfield's heights, in each of `buildGrid`'s three shapes -- a converted world with a tiler (the tiled shape), the same
// without it (the family shape), Monument (the plain shape, colour from `colorAt`), and a synthetic ruled real-elevation
// world (the family shape with the rules' families moved by the edit) -- the chunk's own arrays kept (so its mesh, material
// and program stay); the heightfield made from the same array stands where the mesh does (a ray down meets every vertex).
// Each shape's case is shown failing on a rewrite of position and normal alone.
//
// Run: node tools/swg/tests/groundRewrite.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { Physics } from '../../../src/core/physics.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { CHUNK_RES, CHUNK_SIZE, chunkHeightfield, Terrain, type ChunkTiler } from '../../../src/world/terrain.ts';
import { HEIGHT_TILE_POLES, HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { DemShader } from '../../../src/world/demShader.ts';
import { PLANETS, type PlanetDef } from '../../../src/data/planets.ts';
import { copyGround } from '../../../src/world/groundRewrite.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const planet = { id: 'test', seed: 1, palette: { low: 0x305020, mid: 0x806040, high: 0xd0d0d0, slope: 0x504030, shore: 0xc0b080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;

function same(a: ArrayLike<number> | null | undefined, b: ArrayLike<number> | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
function sameChunk(g: THREE.BufferGeometry, h: Float32Array, f: { geometry: THREE.BufferGeometry; heights: Float32Array }): string {
  const ka = Object.keys(g.attributes).sort();
  if (ka.join() !== Object.keys(f.geometry.attributes).sort().join()) return 'the attributes';
  for (const k of ka) if (!same((g.attributes[k] as THREE.BufferAttribute).array, (f.geometry.attributes[k] as THREE.BufferAttribute).array)) return k;
  if (!same(g.getIndex()?.array, f.geometry.getIndex()?.array)) return 'the index';
  if (!same(h, f.heights)) return 'the heights';
  return '';
}
/** The design's first cut, as a mutant: position and normal copied in, nothing else. */
function rewriteTwo(g: THREE.BufferGeometry, fresh: THREE.BufferGeometry): void {
  for (const k of ['position', 'normal']) ((g.attributes[k] as THREE.BufferAttribute).array as Float32Array).set((fresh.attributes[k] as THREE.BufferAttribute).array as Float32Array);
}

/** A bump of `amp` metres over a raw-frame disc, into the store's tiles. Answers the raw rectangle it touched. */
function bump(store: HeightEdits, cx: number, cz: number, R: number, amp: number): { x0: number; z0: number; x1: number; z1: number } {
  const r = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (let pz = Math.ceil((cz - R) / 2); pz <= Math.floor((cz + R) / 2); pz++) {
    for (let px = Math.ceil((cx - R) / 2); px <= Math.floor((cx + R) / 2); px++) {
      const d = Math.hypot(px * 2 - cx, pz * 2 - cz);
      if (d > R) continue;
      const tx = Math.floor(px / HEIGHT_TILE_POLES);
      const tz = Math.floor(pz / HEIGHT_TILE_POLES);
      const t = store.writable(tx, tz)!;
      t[(pz - tz * HEIGHT_TILE_POLES) * HEIGHT_TILE_POLES + (px - tx * HEIGHT_TILE_POLES)] += amp * (1 - (d / R) ** 2);
      r.x0 = Math.min(r.x0, px * 2);
      r.x1 = Math.max(r.x1, px * 2);
      r.z0 = Math.min(r.z0, pz * 2);
      r.z1 = Math.max(r.z1, pz * 2);
    }
  }
  return r;
}

const physics = await Physics.create();

/** A chunk built, the ground edited under it, rewritten in place, and held to a fresh build; then the mutant. */
function check(name: string, t: Terrain, cx: number, cz: number, edit: () => void): void {
  t.prepareChunk(cx, cz, true);
  const built = t.buildChunk(cx, cz);
  const arrays = Object.fromEntries(Object.entries(built.geometry.attributes).map(([k, a]) => [k, (a as THREE.BufferAttribute).array]));
  const mutant = built.geometry.clone();
  const mutantHeights = built.heights.slice();
  edit();
  // A rewrite is the same chunk counted once: the tiler's census (which a build adds the chunk's tiles to) is put back as it was.
  const census = t.tiler ? t.tiler.census.slice() : null;
  const did = t.rewriteChunk(cx, cz, built.geometry, built.heights);
  if (census) ok(census.some((v) => v > 0) && same(census, t.tiler!.census), `${name}: the rewrite leaves the tiler's census as the first build left it (${Array.from(census).join(', ')})`);
  const fresh = t.buildChunk(cx, cz);
  const apart = sameChunk(built.geometry, built.heights, fresh);
  const kept = Object.entries(built.geometry.attributes).every(([k, a]) => (a as THREE.BufferAttribute).array === arrays[k]);
  const moved = !same(mutantHeights, fresh.heights);
  ok(did && !apart && kept && moved, `${name}: the chunk rewritten in place is a fresh build after the edit by Object.is (every attribute, the index, the heights), into its own arrays${apart ? `; apart in ${apart}` : ''}`);
  // The heightfield made from the same array stands where the mesh does.
  const col = chunkHeightfield(physics, { origin: built.origin, heights: built.heights });
  physics.stepOnce();
  const pos = built.geometry.getAttribute('position') as THREE.BufferAttribute;
  let worst = 0;
  for (let v = 0; v < Math.min(pos.count, 600); v += 7) {
    const x = pos.getX(v);
    const y = pos.getY(v);
    const z = pos.getZ(v);
    if (x < built.origin.x + 0.1 || x > built.origin.x + CHUNK_SIZE - 0.1 || z < built.origin.z + 0.1 || z > built.origin.z + CHUNK_SIZE - 0.1) continue;
    const d = physics.groundDistance(x, y + 50, z, 200);
    worst = Math.max(worst, d === null ? Infinity : Math.abs(y + 50 - d - y));
  }
  physics.removeCollider(col);
  ok(worst < 1e-3, `${name}: the heightfield made from the rewritten heights meets the mesh (worst ${worst.toExponential(1)} m)`);
  // The mutant: position and normal alone, as the design's first cut would have written them.
  rewriteTwo(mutant, fresh.geometry);
  ok(sameChunk(mutant, mutantHeights, fresh) !== '', `${name}: a rewrite of position and normal alone is not the fresh build (${sameChunk(mutant, mutantHeights, fresh)} apart)`);
}

// A converted world: with a tiler (the tiled shape) and without (the family shape).
const worlds = groundWorlds();
const world = ['tatooine', 'naboo'].find((w) => worlds.includes(w)) ?? worlds[0];
if (!world) note(`no converted worlds under ${PACKS}: the converted shapes are skipped`);
else {
  const dir = join(PACKS, world);
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(join(dir, 'layout.json'), 'utf8').slice(0, 8000))!;
  for (const tiled of [true, false]) {
    const store = new HeightEdits();
    const sw = await SwgTerrain.create(bytes('terrain.trn')!, [], Number(m[1]), Number(m[2]), async (f) => bytes(f), { heights: store });
    const t = new Terrain(planet);
    t.attachSwg(sw);
    if (tiled) t.tiler = { rank: (f: number) => f, layer: (f: number) => f, corners: [0, 1, 2, 3], census: new Float64Array(5) } as unknown as ChunkTiler;
    const o = t.chunkOrigin(1, -1);
    check(`${world}, the ${tiled ? 'tiled' : 'family'} shape`, t, 1, -1, () => {
      const r = bump(store, sw.toSwgX(o.x + 30), sw.toSwgZ(o.z + 30), 26, 9);
      sw.relayRect(sw.toGameX(r.x1), sw.toGameZ(r.z0), sw.toGameX(r.x0), sw.toGameZ(r.z1));
    });
  }
  // A far tile rewritten in place (at a stroke's end, `Terrain.rewriteFarTile`): its far grid laid again by the edit, the
  // tile is a fresh `buildFarTile` after it by Object.is over every attribute, into its own arrays, its index (its cut under
  // the chunks) the very array it had.
  {
    const FAR = 512;
    const RES = 32;
    const store = new HeightEdits();
    const sw = await SwgTerrain.create(bytes('terrain.trn')!, [], Number(m[1]), Number(m[2]), async (f) => bytes(f), { heights: store });
    const t = new Terrain(planet);
    t.attachSwg(sw);
    const geo = t.buildFarTile(0, -1, FAR, RES, true)!;
    const before = (geo.getAttribute('position') as THREE.BufferAttribute).array.slice();
    const arrays = Object.fromEntries(Object.entries(geo.attributes).map(([k, a]) => [k, (a as THREE.BufferAttribute).array]));
    const index = geo.getIndex();
    const indexArray = index?.array;
    const ox = geo.userData.ox as number;
    const oz = geo.userData.oz as number;
    const r = bump(store, sw.toSwgX(ox + 200), sw.toSwgZ(oz + 260), 70, 30);
    sw.relayRect(sw.toGameX(r.x1), sw.toGameZ(r.z0), sw.toGameX(r.x0), sw.toGameZ(r.z1));
    const did = t.rewriteFarTile(0, -1, FAR, RES, geo);
    const fresh = t.buildFarTile(0, -1, FAR, RES, true)!;
    let apart = '';
    for (const k of Object.keys(fresh.attributes)) if (!same((geo.attributes[k] as THREE.BufferAttribute).array, (fresh.attributes[k] as THREE.BufferAttribute).array)) apart ||= k;
    const kept = Object.entries(geo.attributes).every(([k, a]) => (a as THREE.BufferAttribute).array === arrays[k]) && geo.getIndex() === index && geo.getIndex()?.array === indexArray;
    const moved = !same(before, (geo.getAttribute('position') as THREE.BufferAttribute).array);
    ok(did && !apart && kept && moved, `${world}: a far tile rewritten in place is a fresh build after the edit by Object.is, into its own arrays, its index kept${apart ? `; apart in ${apart}` : ''}`);
  }
}

// Monument: the plain shape.
{
  const mon = PLANETS.find((p) => p.id === 'monument');
  const dirOf = mon?.dem ? join(REPO, 'public', mon.dem.url.replace(/^\//, '')) : '';
  if (!mon?.dem || !existsSync(join(dirOf, 'base16.raw'))) note('no Monument raster in this checkout: its plain shape is skipped');
  else {
    const raw = readFileSync(join(dirOf, 'base16.raw'));
    const meta = JSON.parse(readFileSync(join(dirOf, 'base.json'), 'utf8'));
    const t = new Terrain(mon);
    const patch = makeDemPatch(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, meta, { size: mon.dem.size, lift: mon.dem.lift, feather: mon.dem.feather ?? 0 });
    t.demDetail = mon.dem.detail ?? 0;
    t.dem = patch;
    t.minH = patch.minHeight + patch.lift;
    t.maxH = patch.maxHeight + patch.lift;
    const store = new HeightEdits();
    t.heights = store;
    const o = t.chunkOrigin(0, 0);
    check('monument, the plain shape', t, 0, 0, () => bump(store, -(o.x + 32), o.z + 32, 28, 14));
  }
}

// A synthetic ruled real-elevation world: the family shape, its rules' families moved by the edit (a slope rule there).
{
  const n = 65;
  const hs = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = 20000 + Math.round(3000 * Math.sin(i * 0.2));
  const t = new Terrain(planet);
  t.dem = makeDemPatch(hs.buffer, { mapWidthInMeters: 1024, base: { samples: n, metresPerSample: 16, minHeight: 0, maxHeight: 400 } }, { size: 1024, lift: 0, feather: 0 });
  t.minH = 0;
  t.maxH = 400;
  t.demShader = new DemShader({ pack: 'test', fallback: 'sand', rules: [{ family: 'rock', aboveSlope: 20 }] }, new Map([['sand', 1], ['rock', 2]]), 0);
  const store = new HeightEdits();
  t.heights = store;
  const o = t.chunkOrigin(0, 0);
  const before = t.buildChunk(0, 0).geometry.getAttribute('aFamily');
  check('a synthetic ruled world, the family shape', t, 0, 0, () => bump(store, -(o.x + 32), o.z + 32, 18, 30));
  const after = t.buildChunk(0, 0).geometry.getAttribute('aFamily');
  ok(!same((before as THREE.BufferAttribute).array, (after as THREE.BufferAttribute).array), "and the rules' families moved with the edit (a steep bump turned to rock)");
}
void CHUNK_RES;

console.log(`\ngroundRewrite: ${checks} checks passed`);
