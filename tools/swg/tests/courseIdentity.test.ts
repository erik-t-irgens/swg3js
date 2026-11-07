// The race drawer's second wave, day one (`A:\swg3js\racedrawer\DESIGN.md` §4 W2, Guards): no drawn course is the ground
// of before. afcf394's `trn.ts`, `swgTerrain.ts` and `terrain.ts` loaded out of git beside today's (`oldModules.ts`), and on
// every converted world on disk (SWG3JS_PACKS, else assets-private) 32 blocks, six far grids, twelve chunks (the family and
// the tiled shape) and the cached reads at 1,000 points, every array by `Object.is`, three ways: no store, an empty store,
// and a store made from track files holding no course (gate-only tracks), each with no heights file and with one of nought
// tiles over every place asked. On Monument (its committed raster, the plain shape) and a synthetic ruled real-elevation
// world (the family shape) `Terrain.heightAt` at 5,000 points and six chunks, with the pole grid of each store. And the
// grass's placing (`placeGrass`, `placeFarCards`) with no road mask is afcf394's; the course zones of an empty store are
// none. A synthetic converted terrain and the synthetic ruled world are held to traces recorded from afcf394 as well, so the
// day one is held where git cannot hand that commit over (`SWG3JS_NO_OLD=1`).
//
// Run: node tools/swg/tests/courseIdentity.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { Terrain, type ChunkTiler } from '../../../src/world/terrain.ts';
import { HeightEdits, tileAt } from '../../../src/swg/terrain/heightEdits.ts';
import { CourseCarve, CourseGrid, type CarveTrack } from '../../../src/swg/terrain/courseCarve.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { DemShader } from '../../../src/world/demShader.ts';
import { PLANETS, type PlanetDef } from '../../../src/data/planets.ts';
import { courseZones } from '../../../src/world/noSpawnZones.ts';
import { groundWorlds, PACKS, sampleBlocks } from './terrainHarness.ts';
import { loadOldMany, oldTexts, REPO } from './oldModules.ts';
import { form, chunk, W, encode, ihdr, mfrc } from './iffWriter.ts';

/** The race drawer's pass began from this commit: the first wave's own, the ground's last before the carve. */
const PRE_W2 = 'afcf394';

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

const mods = await loadOldMany(['src/swg/terrain/trn.ts', 'src/world/swgTerrain.ts', 'src/world/terrain.ts', 'src/world/grassMath.ts'], ['src/world/swgTerrain.ts', 'src/world/terrain.ts', 'src/world/grassMath.ts'], PRE_W2);
if (!mods) note(`git cannot hand ${PRE_W2} over here: the day-one comparison is skipped`);
const OldSwg = mods?.[0].SwgTerrain as typeof SwgTerrain | undefined;
const OldTerrain = mods?.[1].Terrain as typeof Terrain | undefined;
const oldGrass = mods?.[2] as Record<string, (...a: unknown[]) => unknown> | undefined;

const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;

/** The three ways of no course: none, an empty store, and a store made from a file of gate-only tracks. */
const WAYS = ['none', 'empty', 'gates only'] as const;
function storeOf(way: (typeof WAYS)[number]): CourseCarve | null {
  if (way === 'none') return null;
  const s = new CourseCarve();
  const tracks: CarveTrack[] = way === 'empty' ? [] : [
    { id: 'dune_loop', kind: 'circuit', clear: 12 },
    { id: 'sprint', kind: 'sprint', clear: 8 },
  ];
  s.set(tracks);
  return s;
}

function centreOf(world: string): { x: number; z: number } | null {
  const file = join(PACKS, world, 'layout.json');
  if (!existsSync(file)) return null;
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}
function noughtsOver(store: HeightEdits, x0: number, z0: number, x1: number, z1: number): void {
  for (let tz = tileAt(Math.min(z0, z1)); tz <= tileAt(Math.max(z0, z1)); tz++) for (let tx = tileAt(Math.min(x0, x1)); tx <= tileAt(Math.max(x0, x1)); tx++) store.writable(tx, tz);
}
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
  for (const edits of [false, true]) {
    const heightsOf = (): HeightEdits | null => {
      if (!edits) return null;
      const h = new HeightEdits();
      noughtsOver(h, -2600 - c.x, -2600 + c.z, 2600 - c.x, 2600 + c.z);
      return h;
    };
    const old = await OldSwg!.create(trn, [], c.x, c.z, fetchBytes, { heights: heightsOf() });
    const blocks = sampleBlocks(old.template as never, 32, 7171);
    const points: { x: number; z: number }[] = [];
    for (let i = 0; i < 1000; i++) points.push({ x: ((i * 7919) % 4000) - 2000 + 0.37, z: ((i * 104729) % 4000) - 2000 - 0.61 });
    for (const way of WAYS) {
      let failed = '';
      const now = await SwgTerrain.create(trn, [], c.x, c.z, fetchBytes, { heights: heightsOf(), course: storeOf(way) });
      for (const b of blocks) {
        if (!sameArrays(old.sampler.generateBlock(b.bx, b.bz), now.sampler.generateBlock(b.bx, b.bz))) failed ||= `block ${b.bx},${b.bz}`;
      }
      for (const [tx, tz] of FARS) {
        const oa = groundChunkOrigin(tx, tz, old.groundShift, FAR_TILE);
        const on = groundChunkOrigin(tx, tz, now.groundShift, FAR_TILE);
        const ga = old.farGrid(oa.x, oa.z, FAR_TILE, FAR_RES, true);
        const gn = now.farGrid(on.x, on.z, FAR_TILE, FAR_RES, true);
        if (!ga || !gn || !sameArrays(ga, gn)) failed ||= `far grid ${tx},${tz}`;
      }
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
      for (const p of points) {
        if (!Object.is(old.heightIfCached(p.x, p.z, FAR_TILE, FAR_RES), now.heightIfCached(p.x, p.z, FAR_TILE, FAR_RES))) failed ||= `heightIfCached at ${p.x},${p.z}`;
        if (!Object.is(old.nearHeightIfCached(p.x, p.z), now.nearHeightIfCached(p.x, p.z))) failed ||= `nearHeightIfCached at ${p.x},${p.z}`;
      }
      // The carved base with no course drawn is the raw pole, as the sculpt's base was.
      for (const b of blocks.slice(0, 4)) {
        const x = b.bx * 64 + 10;
        const z = b.bz * 64 + 22;
        if (!Object.is(now.sampler.basePoleAt(x, z), now.sampler.rawPoleAt(x, z))) failed ||= `basePoleAt at ${x},${z}`;
      }
      ok(!failed, `${world}, ${edits ? 'a heights file of nought tiles' : 'no heights file'}, ${way === 'none' ? 'no store' : way === 'empty' ? 'an empty store' : 'a store of gate-only tracks'}: 32 blocks, six far grids, twelve chunks and the cached reads are ${PRE_W2}'s by Object.is${failed ? ` (first apart: ${failed})` : ''}`);
    }
  }
}

// Monument (its committed raster) and a synthetic ruled world, with the pole grid of each store.
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
    for (let i = 0; i < 5000; i++) pts.push({ x: ((i * 7919) % 2000) - 1000 + 0.29, z: ((i * 104729) % 2000) - 1000 - 0.41 });
    const old = w.make(OldTerrain);
    for (const way of WAYS) {
      const t = w.make(Terrain);
      const s = storeOf(way);
      if (s) {
        const g = new CourseGrid(s);
        g.all();
        g.step(Infinity, 0, 0, () => 0);
        t.courseGrid = g;
      }
      let failed = '';
      for (const p of pts) if (!Object.is(old.heightAt(p.x, p.z), t.heightAt(p.x, p.z))) failed ||= `heightAt ${p.x},${p.z}`;
      for (const [cx, cz] of CHUNKS) if (!sameChunk(old.buildChunk(cx, cz), t.buildChunk(cx, cz))) failed ||= `chunk ${cx},${cz}`;
      for (const p of pts.slice(0, 200)) if (!Object.is(t.groundBaseAt(p.x, p.z), t.groundRawAt(p.x, p.z))) failed ||= `groundBaseAt ${p.x},${p.z}`;
      ok(!failed, `${w.name}, ${way === 'none' ? 'no store' : way === 'empty' ? "an empty store's pole grid" : "a gate-only store's pole grid"}: heightAt at 5,000 points and six chunks are ${PRE_W2}'s by Object.is, and the base is the raw ground${failed ? ` (first apart: ${failed})` : ''}`);
    }
  }
}

// Recorded traces: a comparison that cannot load the old code holds to hashes recorded from it, never to a note (the
// thirteenth wave's lesson). Over a synthetic converted terrain (terrain.test's own .trn, built in memory) and the synthetic
// ruled real-elevation world, the trace of no course (each of the three ways, with no heights file and a file of nought
// tiles) is hashed and held to the hash recorded from afcf394's modules, whether or not git answers; where git answers, the
// old modules' own trace is held to the same hash, so a recorded hash cannot go stale unseen. `SWG3JS_NO_OLD=1` runs the
// first half alone, as on a machine with no git.
const HB = new DataView(new ArrayBuffer(8));
function fold(h: number, v: number): number {
  HB.setFloat64(0, v);
  for (let i = 0; i < 8; i++) h = Math.imul(h ^ HB.getUint8(i), 16777619) >>> 0;
  return h;
}
function foldArr(h: number, a: AnyArr | null | undefined): number {
  if (!a) return fold(h, -1);
  h = fold(h, a.length);
  for (let i = 0; i < a.length; i++) h = fold(h, a[i]);
  return h;
}
function foldArrays(h: number, o: object): number {
  const m = arraysOf(o);
  for (const k of [...m.keys()].sort()) h = foldArr(h, m.get(k));
  return h;
}
function foldChunk(h: number, c: { geometry: THREE.BufferGeometry; heights: Float32Array }): number {
  for (const k of Object.keys(c.geometry.attributes).sort()) h = foldArr(h, (c.geometry.attributes[k] as THREE.BufferAttribute).array);
  h = foldArr(h, c.geometry.getIndex()?.array ?? null);
  return foldArr(h, c.heights);
}
const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0');

/** terrain.test's synthetic .trn: a fractal family, a circle flattened inside it, a slope-filtered rectangle raised and painted. */
function synthTrn(): ArrayBuffer {
  const header = new W().str('test').f32(1024).f32(32).i32(8).i32(0).f32(0).f32(2).str('').f32(60)
    .f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(0).bytes();
  const sgrp = form('SGRP', form('0006', chunk('SFAM', new W().i32(1).str('sand').str('').u8(1).u8(2).u8(3).f32(2).f32(0.5).i32(1).str('shader/x.sht').f32(1).bytes())));
  const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('hills').bytes()), mfrc(1337, { oct: 3, freq: 2, amp: 0.5, sx: 0.02, sy: 0.02 }))));
  const ahfr = form('AHFR', form('0003', ihdr('hills'), form('DATA', chunk('PARM', new W().i32(1).i32(1).f32(50).bytes()))));
  const bcir = form('BCIR', form('0002', ihdr('circle'), chunk('DATA', new W().f32(100).f32(100).f32(40).i32(1).f32(0.5).bytes())));
  const ahcn = (op: number, h: number) => form('AHCN', form('0000', ihdr('flat'), chunk('DATA', new W().i32(op).f32(h).bytes())));
  const subB = form('LAYR', form('0003', ihdr('B'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), bcir, ahcn(0, 7)));
  const layerA = form('LAYR', form('0003', ihdr('A'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), ahfr, subB));
  const brec = form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(200).f32(-50).f32(260).f32(10).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
  const fslp = form('FSLP', form('0002', ihdr('slope'), chunk('DATA', new W().f32(0).f32(89).i32(0).f32(0).bytes())));
  const ascn = form('ASCN', form('0001', ihdr('sand'), chunk('DATA', new W().i32(1).i32(0).f32(1).bytes())));
  const layerC = form('LAYR', form('0003', ihdr('C'), chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes()), brec, fslp, ahcn(1, 3), ascn));
  const tgen = form('TGEN', form('0000', sgrp, form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS', layerA, layerC)));
  const b = encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE'))));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** The synthetic converted terrain's trace: blocks, far grids, chunks (both shapes) and the cached reads, hashed. */
async function synthTrace(Swg: typeof SwgTerrain, T: typeof Terrain, way: (typeof WAYS)[number], edits: boolean): Promise<string> {
  let heights: HeightEdits | null = null;
  if (edits) {
    heights = new HeightEdits();
    noughtsOver(heights, -600, -600, 600, 600);
  }
  const sw = await Swg.create(synthTrn(), [], 0, 0, async () => null, { heights, course: storeOf(way) });
  let h = 2166136261;
  for (const [bx, bz] of [[0, 0], [-1, 1], [2, -3], [-4, -2], [3, 3], [-2, 4], [5, -1], [1, 2]] as const) h = foldArrays(h, sw.sampler.generateBlock(bx, bz));
  for (const [tx, tz] of FARS.slice(0, 4)) {
    const o = groundChunkOrigin(tx, tz, sw.groundShift, FAR_TILE);
    const g = sw.farGrid(o.x, o.z, FAR_TILE, FAR_RES, true);
    h = g ? foldArrays(h, g) : fold(h, -2);
  }
  for (const tiled of [false, true]) {
    const t = new T(planet);
    t.attachSwg(sw as never);
    if (tiled) t.tiler = tilerOf();
    for (const [cx, cz] of CHUNKS) {
      t.prepareChunk(cx, cz, true);
      h = foldChunk(h, t.buildChunk(cx, cz));
    }
  }
  for (let i = 0; i < 300; i++) {
    const x = ((i * 7919) % 1000) - 500 + 0.37;
    const z = ((i * 104729) % 1000) - 500 - 0.61;
    h = fold(fold(h, sw.heightIfCached(x, z, FAR_TILE, FAR_RES)), sw.nearHeightIfCached(x, z));
  }
  return hex(h);
}

/** The synthetic ruled world's trace: `heightAt` at 2,000 points and six chunks, hashed. */
async function ruledTrace(T: typeof Terrain, way: (typeof WAYS)[number]): Promise<string> {
  const w = (await demWorlds()).find((d) => d.name === 'a synthetic ruled world')!;
  const t = w.make(T);
  const s = storeOf(way);
  if (s && T === Terrain) {
    const g = new CourseGrid(s);
    g.all();
    g.step(Infinity, 0, 0, () => 0);
    t.courseGrid = g;
  }
  let h = 2166136261;
  for (let i = 0; i < 2000; i++) h = fold(h, t.heightAt(((i * 7919) % 2000) - 1000 + 0.29, ((i * 104729) % 2000) - 1000 - 0.41));
  for (const [cx, cz] of CHUNKS) h = foldChunk(h, t.buildChunk(cx, cz));
  return hex(h);
}

/** Recorded from afcf394's `swgTerrain.ts`, `trn.ts` and `terrain.ts` (the synthetic .trn) and `terrain.ts` (the ruled world). */
const SYNTH_TRACE = '3c568865';
const RULED_TRACE = 'bed1625e';
{
  const now: string[] = [];
  for (const way of WAYS) for (const edits of [false, true]) now.push(await synthTrace(SwgTerrain, Terrain, way, edits));
  const ruled: string[] = [];
  for (const way of WAYS) ruled.push(await ruledTrace(Terrain, way));
  if (OldSwg && OldTerrain) {
    const was = await synthTrace(OldSwg, OldTerrain, 'none', false);
    const wasRuled = await ruledTrace(OldTerrain, 'none');
    ok(was === SYNTH_TRACE && wasRuled === RULED_TRACE, `${PRE_W2}'s own traces are the hashes recorded from it (${was}, ${wasRuled})`);
  } else note(`git cannot hand ${PRE_W2} over: the recorded hashes are held without it`);
  ok(now.every((h) => h === SYNTH_TRACE), `a synthetic converted terrain with no course (three ways, with and without a heights file of nought tiles) is the trace recorded from ${PRE_W2} (${SYNTH_TRACE})`);
  ok(ruled.every((h) => h === RULED_TRACE), `the synthetic ruled world with no course (three ways) is the trace recorded from ${PRE_W2} (${RULED_TRACE})`);
}

// What the life and the props of no course rest on (§4's Guards, risk §8.1): `props.ts` cannot load in node (a parameter
// property, imports without their extensions), and the wild sites' laying, the standing rows and the zones are the same code
// as afcf394's but for the wave's own additions. So each file's text, its line endings folded and the wave's additions taken
// out, is held to afcf394's own, read out of git where git answers and to a hash recorded from it always; what differs with
// no course is then only `world.ts`'s no-course branches, which `courseWiring.test.ts` pins as text.
{
  const files = ['src/world/props.ts', 'src/world/mobiles/lairs.ts', 'src/swg/terrain/heightEdits.ts', 'src/world/standingPeople.ts', 'src/world/wildLife.ts', 'src/world/noSpawnZones.ts'];
  /** The wave's additions to each file, by the line that opens each. */
  const added: Record<string, string[]> = {
    'src/world/standingPeople.ts': ['  rowsZonedBy(zones: '],
    'src/world/wildLife.ts': ['  sitesKeptOffBy(areas: '],
    'src/world/noSpawnZones.ts': ['export function courseZones(', 'export function sameCourseZones('],
  };
  /** A text with one block taken out: the doc comment over the line that opens it, to its closing brace, and a blank line after. */
  const without = (text: string, opens: string): string => {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.startsWith(opens));
    if (at < 0) return text;
    const indent = /^\s*/.exec(lines[at])![0];
    let from = at;
    if (lines[at - 1]?.trim() === '*/') while (from > 0 && lines[from - 1].trim() !== '/**') from--;
    if (from !== at) from--;
    let to = at;
    while (to < lines.length && lines[to] !== `${indent}}`) to++;
    if (lines[to + 1] === '') to++;
    return [...lines.slice(0, from), ...lines.slice(to + 1)].join('\n');
  };
  const hash = (s: string): string => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h.toString(16).padStart(8, '0');
  };
  /** Recorded from afcf394's own texts, their line endings folded. */
  const RECORDED: Record<string, string> = {
    'src/world/props.ts': 'eb652d37',
    'src/world/mobiles/lairs.ts': 'a6a16b73',
    'src/swg/terrain/heightEdits.ts': '121e75bf',
    'src/world/standingPeople.ts': '583213c8',
    'src/world/wildLife.ts': 'b624cfb5',
    'src/world/noSpawnZones.ts': '8a1b2a9f',
  };
  const was = oldTexts(files, PRE_W2);
  const apart: string[] = [];
  const seen: string[] = [];
  for (const f of files) {
    let now = readFileSync(join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
    for (const o of added[f] ?? []) now = without(now, o);
    seen.push(`${f}=${hash(now)}`);
    if (hash(now) !== RECORDED[f]) apart.push(`${f} (today's less the wave's additions ${hash(now)})`);
    const old = was?.get(f);
    if (old !== undefined && hash(old.replace(/\r\n/g, '\n')) !== RECORDED[f]) apart.push(`${f} (${PRE_W2}'s own ${hash(old.replace(/\r\n/g, '\n'))})`);
  }
  if (!was) note(`git cannot hand ${PRE_W2} over: the files are held to the hashes recorded from it`);
  if (apart.length) note(seen.join(' '));
  ok(!apart.length, `props.ts, lairs.ts, heightEdits.ts, standingPeople.ts, wildLife.ts and noSpawnZones.ts are ${PRE_W2}'s to the character but for the wave's own additions (\`rowsZonedBy\`, \`sitesKeptOffBy\`, \`courseZones\`, \`sameCourseZones\`)${apart.length ? `: apart ${apart.join(', ')}` : ''}`);
}

// The grass's placing with no road mask (the grass's and far cards' masks are the carve's only reach into it).
if (oldGrass) {
  const nowGrass = await import('../../../src/world/grassMath.ts');
  const names = Object.keys(nowGrass).filter((k) => typeof (nowGrass as Record<string, unknown>)[k] === 'function');
  ok(['placeGrass', 'placeFarCards'].every((k) => names.includes(k) && typeof oldGrass[k] === 'function'), 'the grass places through `placeGrass` and `placeFarCards`, as before');
  ok(nowGrass.placeGrass.length === (oldGrass.placeGrass as (...a: unknown[]) => unknown).length && nowGrass.placeFarCards.length === (oldGrass.placeFarCards as (...a: unknown[]) => unknown).length, 'and the road mask is an argument with a default (null), so every caller of before places as it did');
}

// The zones of no course are none: the removal file's zone set stands as it was.
{
  const empty = new CourseCarve();
  empty.set([]);
  ok(courseZones(empty.outlines()).length === 0 && empty.outlines().length === 0 && empty.extent() === null, 'an empty store has no outline, no zone and no extent');
  const gates = storeOf('gates only')!;
  ok(gates.empty && gates.outlines().length === 0 && !gates.touches(-1e6, -1e6, 1e6, 1e6) && !gates.roadAt(0, 0, 0), "a store of gate-only tracks is empty, touches nothing and has no road");
}

console.log(`\ncourseIdentity: ${checks} checks passed`);
