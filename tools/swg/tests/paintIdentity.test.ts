// The proof that no paint is today's ground (Map-maker II, DESIGN.md §2.5, W2): e6c2578's `trn.ts`, `generator.ts`,
// `swgTerrain.ts`, `terrain.ts` and `workerCore.ts` loaded out of git beside today's, and on every converted world on disk
// (SWG3JS_PACKS, else assets-private) 24 blocks, six far grids, six chunks built with the pack's own tiler (the tiled shape)
// and six without (the family shape), and the terrain worker's grids for four blocks, every array by `Object.is`, three
// ways: no paint, an empty paint, and a paint of nought tiles (family and colour, a palette resolved) over every place
// asked. And Monument (its committed raster: the plain shape) and a synthetic ruled real-elevation world (the family
// shape from rules) with no paint, a paint handed to its rules that paints nothing, and no world row: heightAt and six
// chunks e6c2578's.
//
// Run: node tools/swg/tests/paintIdentity.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { Terrain, type ChunkTiler } from '../../../src/world/terrain.ts';
import { GroundPaint, PAINT_TILE } from '../../../src/swg/terrain/groundPaint.ts';
import { TerrainWorkerCore } from '../../../src/swg/terrain/workerCore.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { DemShader } from '../../../src/world/demShader.ts';
import { assembleTileArrays, makeTiler, tileEntries, tileLookups, type ShaderFamilyDef } from '../../../src/world/terrainTextures.ts';
import { PLANETS, type PlanetDef } from '../../../src/data/planets.ts';
import { groundWorlds, PACKS, sampleBlocks } from './terrainHarness.ts';
import { loadOldMany, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

type AnyArr = ArrayLike<number>;
function same(a: AnyArr | null | undefined, b: AnyArr | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
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
function sameChunk(a: { geometry: THREE.BufferGeometry; heights: Float32Array }, b: { geometry: THREE.BufferGeometry; heights: Float32Array }): boolean {
  const ka = Object.keys(a.geometry.attributes).sort();
  const kb = Object.keys(b.geometry.attributes).sort();
  if (ka.join() !== kb.join()) return false;
  for (const k of ka) if (!same((a.geometry.attributes[k] as THREE.BufferAttribute).array, (b.geometry.attributes[k] as THREE.BufferAttribute).array)) return false;
  return same(a.geometry.getIndex()?.array ?? null, b.geometry.getIndex()?.array ?? null) && same(a.heights, b.heights);
}

const mods = await loadOldMany(['src/swg/terrain/trn.ts', 'src/swg/terrain/generator.ts', 'src/world/swgTerrain.ts', 'src/world/terrain.ts', 'src/swg/terrain/workerCore.ts'], ['src/world/swgTerrain.ts', 'src/world/terrain.ts', 'src/swg/terrain/workerCore.ts']);
if (!mods) note('git cannot hand e6c2578 over here: the day-one comparison is skipped');
const OldSwg = mods?.[0].SwgTerrain as typeof SwgTerrain | undefined;
const OldTerrain = mods?.[1].Terrain as typeof Terrain | undefined;
const OldCore = mods?.[2].TerrainWorkerCore as typeof TerrainWorkerCore | undefined;

const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}

/** The pack's own tiler as the game makes it (its pictures stood in by one texel each: the layers are what count). */
function packTiler(world: string, swg: SwgTerrain): ChunkTiler | null {
  const f = join(PACKS, world, 'terrain', 'shaders.json');
  if (!existsSync(f)) return null;
  const file = JSON.parse(readFileSync(f, 'utf8')) as { version?: number; families: ShaderFamilyDef[] };
  if ((file.version ?? 0) < 4) return null;
  const families = file.families.filter((x) => x.children?.length);
  const entries = tileEntries(families, false);
  const arrays = assembleTileArrays(families, entries, entries.map(() => true), 1, { colour: () => [0, 0, 0, 255], normal: () => null, gloss: () => null })!;
  const group = swg.template.generator.shaderGroup;
  const planetFamilies = new Map<number, string>([...group.families.values()].map((x) => [x.id, x.name]));
  const { childLayers, priority } = tileLookups(planetFamilies, families, arrays.childLayersByName);
  return makeTiler(childLayers, priority, group, false) as unknown as ChunkTiler;
}

/** A paint of nought tiles (families and colours) over a raw-frame rectangle, its palette resolved to two of the world's families. */
function noughtPaint(group: SwgTerrain['template']['generator']['shaderGroup'], pack: string, x0: number, z0: number, x1: number, z1: number): GroundPaint {
  const p = new GroundPaint();
  const names = [...group.families.values()].slice(0, 2).map((f) => ({ pack, name: f.name }));
  p.resolve(names, group, pack);
  for (let tz = Math.floor(Math.min(z0, z1) / PAINT_TILE); tz <= Math.floor(Math.max(z0, z1) / PAINT_TILE); tz++) {
    for (let tx = Math.floor(Math.min(x0, x1) / PAINT_TILE); tx <= Math.floor(Math.max(x0, x1) / PAINT_TILE); tx++) {
      p.familyTile(tx, tz, true);
      p.colourTile(tx, tz, true);
    }
  }
  return p;
}

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
let tiledWorlds = 0;
for (const world of OldSwg && OldTerrain && OldCore ? worlds : []) {
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
  const blocks = sampleBlocks(old.template as never, 24, 4242);
  // The raw rectangle every place asked reaches: the blocks, the far grids and the chunks.
  let rx0 = Infinity;
  let rz0 = Infinity;
  let rx1 = -Infinity;
  let rz1 = -Infinity;
  const reach = (x: number, z: number) => {
    rx0 = Math.min(rx0, x);
    rx1 = Math.max(rx1, x);
    rz0 = Math.min(rz0, z);
    rz1 = Math.max(rz1, z);
  };
  for (const b of blocks) {
    reach(b.bx * 64 - 8, b.bz * 64 - 8);
    reach(b.bx * 64 + 72, b.bz * 64 + 72);
  }
  reach(old.toSwgX(-2600), old.toSwgZ(-2600));
  reach(old.toSwgX(2600), old.toSwgZ(2600));
  const tilerOld = packTiler(world, old);
  if (tilerOld) tiledWorlds++;
  // The old worker's grids for four blocks, made once.
  const oldCore = new OldCore!();
  const init = { type: 'init' as const, trn: trn.slice(0), layers: [], bitmaps: [] as { familyId: number; bytes: ArrayBuffer }[], ramps: [] };
  oldCore.handle(init);
  const workerBlocks = blocks.slice(0, 4).map((b) => old.sampler.blockStart(b.bx, b.bz));
  const oldGrids = workerBlocks.map((s, id) => oldCore.handle({ type: 'generate', id, startX: s.x, startZ: s.z, n: old.sampler.numberOfPoles, step: old.sampler.poleStep }).message);
  for (const way of ['none', 'empty', 'noughts'] as const) {
    const paint = way === 'none' ? null : way === 'empty' ? new GroundPaint() : noughtPaint(old.template.generator.shaderGroup, world, rx0, rz0, rx1, rz1);
    const now = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { paint });
    let failed = '';
    for (const b of blocks) {
      const a = old.sampler.generateBlock(b.bx, b.bz);
      const n = now.sampler.generateBlock(b.bx, b.bz);
      if (!sameArrays(a, n)) failed ||= `block ${b.bx},${b.bz}`;
    }
    for (const [tx, tz] of FARS) {
      const oa = groundChunkOrigin(tx, tz, old.groundShift, FAR_TILE);
      const on = groundChunkOrigin(tx, tz, now.groundShift, FAR_TILE);
      const ga = old.farGrid(oa.x, oa.z, FAR_TILE, FAR_RES, true);
      const gn = now.farGrid(on.x, on.z, FAR_TILE, FAR_RES, true);
      if (!ga || !gn || !sameArrays(ga, gn)) failed ||= `far grid ${tx},${tz}`;
    }
    // Chunks: the family shape (no tiler) and the tiled shape (the pack's own tiler, a fresh one each side).
    for (const tiled of [false, true]) {
      if (tiled && !tilerOld) continue;
      const ta = new OldTerrain!(planet);
      ta.attachSwg(old as never);
      const tn = new Terrain(planet);
      tn.attachSwg(now);
      if (tiled) {
        ta.tiler = packTiler(world, old);
        tn.tiler = packTiler(world, now);
      }
      for (const [cx, cz] of CHUNKS) {
        ta.prepareChunk(cx, cz, true);
        tn.prepareChunk(cx, cz, true);
        if (!sameChunk(ta.buildChunk(cx, cz), tn.buildChunk(cx, cz))) failed ||= `${tiled ? 'tiled' : 'family'} chunk ${cx},${cz}`;
      }
    }
    // The worker: the same grids, the paint handed at its init (none, empty, noughts) and once more as a `paint` message.
    const core = new TerrainWorkerCore();
    core.handle({ ...init, trn: trn.slice(0), paint: paint && !paint.empty ? paint.message(null, null, true) : null, rev: 1 });
    if (paint) core.handle({ type: 'paint', rev: 2, paint: paint.message(null, null, true) });
    workerBlocks.forEach((s, id) => {
      const m = core.handle({ type: 'generate', id, startX: s.x, startZ: s.z, n: now.sampler.numberOfPoles, step: now.sampler.poleStep }).message;
      if (!sameArrays(oldGrids[id], m)) failed ||= `the worker's grid ${id}`;
    });
    ok(!failed, `${world}, ${way === 'none' ? 'no paint' : way === 'empty' ? 'an empty paint' : 'a paint of nought tiles'}: 24 blocks, six far grids, ${tilerOld ? 'twelve chunks (family and the pack\'s own tiler)' : 'six chunks (the family shape)'} and four worker grids are e6c2578's by Object.is${failed ? ` (first apart: ${failed})` : ''}`);
  }
}
if (worlds.length && OldSwg) ok(tiledWorlds > 0 || !worlds.length, `the tiled shape was held on ${tiledWorlds} worlds whose packs carry terrain shaders version 4`);

// Monument (its committed raster: the plain shape), and a synthetic ruled world (the family shape from rules).
async function demWorlds(): Promise<{ name: string; make: (T: typeof Terrain) => Terrain; ruled: boolean }[]> {
  const out: { name: string; make: (T: typeof Terrain) => Terrain; ruled: boolean }[] = [];
  const mon = PLANETS.find((p) => p.id === 'monument');
  const rawFile = mon?.dem ? join(REPO, 'public', mon.dem.url.replace(/^\//, ''), 'base16.raw') : '';
  if (mon?.dem && existsSync(rawFile)) {
    const raw = readFileSync(rawFile);
    const meta = JSON.parse(readFileSync(join(REPO, 'public', mon.dem.url.replace(/^\//, ''), 'base.json'), 'utf8'));
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const d = mon.dem;
    out.push({
      name: 'monument',
      ruled: false,
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
  const n = 65;
  const hs = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = Math.round(20000 + 15000 * Math.sin(i * 0.31) * Math.cos(j * 0.23));
  const meta = { mapWidthInMeters: 1024, base: { samples: n, metresPerSample: 16, minHeight: 0, maxHeight: 400 } };
  const rules = { pack: 'test', fallback: 'sand', rules: [{ family: 'rock', aboveSlope: 12 }, { family: 'snow', aboveElevation: 170 }] };
  const fams = new Map([['sand', 1], ['rock', 2], ['snow', 3]]);
  out.push({
    name: 'a synthetic ruled world',
    ruled: true,
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
    for (let i = 0; i < 4000; i++) pts.push({ x: ((i * 7919) % 2000) - 1000 + 0.29, z: ((i * 104729) % 2000) - 1000 - 0.41 });
    const old = w.make(OldTerrain);
    for (const way of ['none', 'empty'] as const) {
      const t = w.make(Terrain);
      // A paint handed to a ruled world's rules, painting nothing; Monument's ground is drawn by no tiler (no world row).
      if (way === 'empty' && t.demShader) t.demShader.paint = new GroundPaint();
      let failed = '';
      for (const p of pts) if (!Object.is(old.heightAt(p.x, p.z), t.heightAt(p.x, p.z))) failed ||= `heightAt ${p.x},${p.z}`;
      for (const [cx, cz] of CHUNKS) if (!sameChunk(old.buildChunk(cx, cz), t.buildChunk(cx, cz))) failed ||= `chunk ${cx},${cz}`;
      ok(!t.tiled, `${w.name}: with no world row its ground is not tiled (no tiler)`);
      const shape = t.buildChunk(0, 0).geometry.getAttribute('aFamily') ? 'family' : 'plain';
      ok(!failed, `${w.name} (the ${shape} shape), ${way === 'none' ? 'no paint' : 'a paint of nothing'}: heightAt at 4,000 points and six chunks are e6c2578's by Object.is${failed ? ` (first apart: ${failed})` : ''}`);
    }
  }
}

console.log(`\npaintIdentity: ${checks} checks passed`);
