// The proof that no heights file is today's ground (Map-maker II, DESIGN.md §2.4, research1 §10): e6c2578's `trn.ts`,
// `generator.ts`, `swgTerrain.ts` and `terrain.ts` loaded out of git beside today's, and on every converted world on disk
// (SWG3JS_PACKS, else assets-private) 48 blocks, six far grids, six chunks with and without a tiler (the tiled shape and the
// family shape), `radialPoleIfCached` at 500 points and `heightIfCached` / `nearHeightIfCached` at 2,000, every array by
// `Object.is`, three ways: no store, an empty store, and a store of nought tiles over every place asked. On Monument (its
// committed raster) `Terrain.heightAt` at 10,000 points and six chunks (the plain shape), and on a synthetic ruled
// real-elevation world six chunks (the family shape from rules), the same three ways. And the client's own baked heights
// (PFPM) once more through a sampler carrying an empty store.
//
// Run: node tools/swg/tests/heightsIdentity.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { CHUNK_SIZE, Terrain, type ChunkTiler } from '../../../src/world/terrain.ts';
import { HeightEdits, HEIGHT_TILE, tileAt } from '../../../src/swg/terrain/heightEdits.ts';
import { TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { DemShader } from '../../../src/world/demShader.ts';
import { PLANETS, type PlanetDef } from '../../../src/data/planets.ts';
import { bakedFlora, groundWorlds, loadWorld, PACKS, sampleBlocks } from './terrainHarness.ts';
import { loadOldMany, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

type AnyArr = ArrayLike<number>;
/** Two arrays the same length and every element the same by `Object.is`. */
function same(a: AnyArr | null | undefined, b: AnyArr | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
/** Every typed array of an object (a block, a far grid), by name. */
function arraysOf(o: object): Map<string, AnyArr> {
  const m = new Map<string, AnyArr>();
  for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && ArrayBuffer.isView(v)) m.set(k, v as unknown as AnyArr);
  return m;
}
function sameArrays(a: object, b: object): boolean {
  const x = arraysOf(a);
  const y = arraysOf(b);
  if (x.size !== y.size) return false;
  for (const [k, v] of x) if (!same(v, y.get(k))) return false;
  return true;
}
/** A geometry's every attribute, its index, and the heights beside it. */
function sameChunk(a: { geometry: THREE.BufferGeometry; heights: Float32Array }, b: { geometry: THREE.BufferGeometry; heights: Float32Array }): boolean {
  const ka = Object.keys(a.geometry.attributes).sort();
  const kb = Object.keys(b.geometry.attributes).sort();
  if (ka.join() !== kb.join()) return false;
  for (const k of ka) if (!same((a.geometry.attributes[k] as THREE.BufferAttribute).array, (b.geometry.attributes[k] as THREE.BufferAttribute).array)) return false;
  return same(a.geometry.getIndex()?.array ?? null, b.geometry.getIndex()?.array ?? null) && same(a.heights, b.heights);
}

const mods = await loadOldMany(['src/swg/terrain/trn.ts', 'src/swg/terrain/generator.ts', 'src/world/swgTerrain.ts', 'src/world/terrain.ts'], ['src/world/swgTerrain.ts', 'src/world/terrain.ts']);
if (!mods) note('git cannot hand e6c2578 over here: the day-one comparison is skipped');
const OldSwg = mods?.[0].SwgTerrain as typeof SwgTerrain | undefined;
const OldTerrain = mods?.[1].Terrain as typeof Terrain | undefined;

const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

/** A store of nought tiles over a raw-frame rectangle (`writable` keeps them, as `set` would drop them). */
function noughtsOver(store: HeightEdits, x0: number, z0: number, x1: number, z1: number): void {
  for (let tz = tileAt(Math.min(z0, z1)); tz <= tileAt(Math.max(z0, z1)); tz++) for (let tx = tileAt(Math.min(x0, x1)); tx <= tileAt(Math.max(x0, x1)); tx++) store.writable(tx, tz);
}

/** A stand-in tiler (groundAlign's): ranks families by id, a layer each. */
const tilerOf = (): ChunkTiler => ({ rank: (f: number) => f, layer: (f: number) => f, corners: [0, 1, 2, 3], census: new Float64Array(5) }) as unknown as ChunkTiler;

const CHUNKS: [number, number][] = [
  [0, 0],
  [-1, 2],
  [3, -2],
  [-4, -1],
  [2, 5],
  [-3, 4],
];
const FARS: [number, number][] = [
  [0, 0],
  [-1, 0],
  [0, 1],
  [1, -1],
  [-2, 2],
  [2, 1],
];
const FAR_TILE = 512;
const FAR_RES = 32;

const worlds = groundWorlds();
if (!worlds.length) note(`no converted worlds under ${PACKS}: the converted half is skipped`);
for (const world of OldSwg && OldTerrain ? worlds : []) {
  const c = centreOf(world);
  if (!c) continue;
  const dir = join(PACKS, world);
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const trn = bytes('terrain.trn');
  if (!trn) continue;
  const fetchBytes = async (file: string) => bytes(file);
  const old = await OldSwg!.create(trn, [], c.x, c.z, fetchBytes);
  const template = old.template;
  const blocks = sampleBlocks(template as never, 48, 4242);
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < 2000; i++) points.push({ x: ((i * 7919) % 4000) - 2000 + 0.37, z: ((i * 104729) % 4000) - 2000 - 0.61 });
  let failed = '';
  for (const way of ['none', 'empty', 'noughts'] as const) {
    const store = way === 'none' ? null : new HeightEdits();
    if (store && way === 'noughts') {
      for (const b of blocks) noughtsOver(store, b.bx * 64 - 8, b.bz * 64 - 8, b.bx * 64 + 72, b.bz * 64 + 72);
      noughtsOver(store, old.toSwgX(2500), old.toSwgZ(-2500), old.toSwgX(-2500), old.toSwgZ(2500));
    }
    const now = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { heights: store });
    // Blocks.
    for (const b of blocks) {
      const a = old.sampler.generateBlock(b.bx, b.bz);
      const n = now.sampler.generateBlock(b.bx, b.bz);
      if (!sameArrays(a, n)) failed ||= `block ${b.bx},${b.bz}`;
    }
    // Far grids.
    for (const [tx, tz] of FARS) {
      const oa = groundChunkOrigin(tx, tz, old.groundShift, FAR_TILE);
      const on = groundChunkOrigin(tx, tz, now.groundShift, FAR_TILE);
      const ga = old.farGrid(oa.x, oa.z, FAR_TILE, FAR_RES, true);
      const gn = now.farGrid(on.x, on.z, FAR_TILE, FAR_RES, true);
      if (!ga || !gn || !sameArrays(ga, gn)) failed ||= `far grid ${tx},${tz}`;
    }
    // Chunks, the family shape and the tiled shape.
    for (const tiled of [false, true]) {
      const ta = new OldTerrain!(planet);
      ta.attachSwg(old as never);
      const tn = new Terrain(planet);
      tn.attachSwg(now);
      if (tiled) {
        ta.tiler = tilerOf();
        tn.tiler = tilerOf();
      }
      for (const [cx, cz] of CHUNKS) {
        ta.prepareChunk(cx, cz, true);
        tn.prepareChunk(cx, cz, true);
        if (!sameChunk(ta.buildChunk(cx, cz), tn.buildChunk(cx, cz))) failed ||= `${tiled ? 'tiled' : 'family'} chunk ${cx},${cz}`;
      }
    }
    // Cached reads.
    for (const p of points.slice(0, 500)) {
      for (const far of [false, true]) {
        const pa = {} as never;
        const pn = {} as never;
        const ra = old.radialPoleIfCached(p.x, p.z, far, pa);
        const rn = now.radialPoleIfCached(p.x, p.z, far, pn);
        if (ra !== rn || JSON.stringify(pa) !== JSON.stringify(pn)) failed ||= `radial pole at ${p.x},${p.z}`;
      }
    }
    for (const p of points) {
      if (!Object.is(old.heightIfCached(p.x, p.z, FAR_TILE, FAR_RES), now.heightIfCached(p.x, p.z, FAR_TILE, FAR_RES))) failed ||= `heightIfCached at ${p.x},${p.z}`;
      if (!Object.is(old.nearHeightIfCached(p.x, p.z), now.nearHeightIfCached(p.x, p.z))) failed ||= `nearHeightIfCached at ${p.x},${p.z}`;
    }
    ok(!failed, `${world}, ${way === 'none' ? 'no store' : way === 'empty' ? 'an empty store' : 'a store of nought tiles'}: 48 blocks, six far grids, twelve chunks (family and tiled) and the cached reads are e6c2578's by Object.is${failed ? ` (first apart: ${failed})` : ''}`);
  }
}

// Monument (its committed raster: the plain shape), and a synthetic ruled world (the family shape from rules).
async function demWorlds(): Promise<{ name: string; make: (T: typeof Terrain) => Terrain }[]> {
  const out: { name: string; make: (T: typeof Terrain) => Terrain }[] = [];
  const mon = PLANETS.find((p) => p.id === 'monument');
  const rawFile = mon?.dem ? join(REPO, 'public', mon.dem.url.replace(/^\//, ''), 'base16.raw') : '';
  if (mon?.dem && existsSync(rawFile)) {
    const raw = readFileSync(rawFile);
    const meta = JSON.parse(readFileSync(join(REPO, 'public', mon.dem.url.replace(/^\//, ''), 'base.json'), 'utf8'));
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const d = mon.dem;
    out.push({
      name: 'monument',
      make: (T) => {
        const t = new T(mon);
        const patch = makeDemPatch(buf, meta, { size: d.size, lift: d.lift, feather: d.feather ?? 0 });
        t.demDetail = d.detail ?? 0;
        t.dem = patch;
        t.minH = patch.minHeight + patch.lift;
        t.maxH = patch.maxHeight + patch.lift;
        t.floor = t.minH - 30;
        return t;
      },
    });
  } else note('no Monument raster in this checkout: its half is skipped');
  // A synthetic ruled real-elevation world: a 65 x 65 raster of hills, rules by slope and by height.
  const n = 65;
  const hs = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = Math.round(20000 + 15000 * Math.sin(i * 0.31) * Math.cos(j * 0.23));
  const meta = { mapWidthInMeters: 1024, base: { samples: n, metresPerSample: 16, minHeight: 0, maxHeight: 400 } };
  const rules = { pack: 'test', fallback: 'sand', rules: [{ family: 'rock', aboveSlope: 12 }, { family: 'snow', aboveElevation: 170 }] };
  const fams = new Map([['sand', 1], ['rock', 2], ['snow', 3]]);
  out.push({
    name: 'a synthetic ruled world',
    make: (T) => {
      const t = new T(planet);
      t.dem = makeDemPatch(hs.buffer.slice(0) as ArrayBuffer, meta, { size: 1024, lift: 0, feather: 0 });
      t.minH = 0;
      t.maxH = 400;
      t.demShader = new DemShader(rules, fams, 0);
      return t;
    },
  });
  return out;
}
if (OldTerrain) {
  for (const w of await demWorlds()) {
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < 10000; i++) pts.push({ x: ((i * 7919) % 2000) - 1000 + 0.29, z: ((i * 104729) % 2000) - 1000 - 0.41 });
    const old = w.make(OldTerrain);
    for (const way of ['none', 'empty', 'noughts'] as const) {
      const t = w.make(Terrain);
      if (way !== 'none') {
        const store = new HeightEdits();
        if (way === 'noughts') noughtsOver(store, -1100, -1100, 1100, 1100);
        t.heights = store;
      }
      let failed = '';
      for (const p of pts) if (!Object.is(old.heightAt(p.x, p.z), t.heightAt(p.x, p.z))) failed ||= `heightAt ${p.x},${p.z}`;
      for (const [cx, cz] of CHUNKS) if (!sameChunk(old.buildChunk(cx, cz), t.buildChunk(cx, cz))) failed ||= `chunk ${cx},${cz}`;
      const shape = t.buildChunk(0, 0).geometry.getAttribute('aFamily') ? 'family' : 'plain';
      ok(!failed, `${w.name} (the ${shape} shape), ${way === 'none' ? 'no store' : way === 'empty' ? 'an empty store' : 'a store of nought tiles'}: heightAt at 10,000 points and six chunks are e6c2578's by Object.is${failed ? ` (first apart: ${failed})` : ''}`);
    }
  }
}

// The client's own baked heights (PFPM), once more through a sampler carrying an empty store: today's ground to its rounding.
for (const name of worlds) {
  const w = loadWorld(name);
  if (!w || !w.template.flora.collidableHeightMap) continue;
  const sampler = new TerrainSampler(w.template);
  sampler.heights = new HeightEdits();
  const r = bakedFlora({ ...w, sampler }, sampleBlocks(w.template, 32));
  if (!r || !r.heightErrors.length) continue;
  const past = r.heightErrors.filter((v) => v > 0.02).length;
  ok(past === 0, `${name}: through a sampler carrying an empty store, the ground is the client's own baked height (PFPM) to its rounding at ${r.heightErrors.length} planted tiles`);
}
void CHUNK_SIZE;
void HEIGHT_TILE;

console.log(`\nheightsIdentity: ${checks} checks passed`);
