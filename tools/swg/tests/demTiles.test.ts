// A real-elevation world on the tile program (Map-maker II, DESIGN.md §2.5, W2):
//
//   1. Monument (its committed raster) with a world row's `base`, a converted world's pack lent for its families: every
//      chunk carries tile bytes and no family attribute, every layer it draws is one of the base family's own alternates
//      in the lent pack's tiler (more than one of them across the chunks, picked by each sample's own choice), its tint
//      white with no wash, and the feet read the base family's surface; a painted cell lays its family there, and every
//      triangle inside the painted cells draws the alternate it forces; and a lent table (held on a pack whose terrain
//      names bitmap families) starts no worker and fetches no bitmap;
//   2. Monument with no world row: not tiled, its chunks e6c2578's by `Object.is` (the plain shape);
//   3. a synthetic ruled real-elevation world on the tile program, sculpted: the chunk written again in place has the
//      rewritten tile bytes and family grid of a fresh build, and the rules read the edited ground (a family moved); and
//      with a world row's base, every sample no rule holds takes the base, never the rules' own fallback.
//
// Run: node tools/swg/tests/demTiles.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { CHUNK_SIZE, Terrain, type ChunkTiler } from '../../../src/world/terrain.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { DemShader } from '../../../src/world/demShader.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { childIndexOf } from '../../../src/swg/terrain/generator.ts';
import { bitmapFiles, parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { GroundPaint } from '../../../src/swg/terrain/groundPaint.ts';
import { assembleTileArrays, makeTiler, tileEntries, tileLookups, type ShaderFamilyDef } from '../../../src/world/terrainTextures.ts';
import { PLANETS, type PlanetDef } from '../../../src/data/planets.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';
import { cellPaint } from './paintHarness.ts';
import { loadOld, REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

function same(a: ArrayLike<number> | null | undefined, b: ArrayLike<number> | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
function sameChunk(a: { geometry: THREE.BufferGeometry; heights: Float32Array }, b: { geometry: THREE.BufferGeometry; heights: Float32Array }): boolean {
  const ka = Object.keys(a.geometry.attributes).sort();
  if (ka.join() !== Object.keys(b.geometry.attributes).sort().join()) return false;
  for (const k of ka) if (!same((a.geometry.attributes[k] as THREE.BufferAttribute).array, (b.geometry.attributes[k] as THREE.BufferAttribute).array)) return false;
  return same(a.geometry.getIndex()?.array ?? null, b.geometry.getIndex()?.array ?? null) && same(a.heights, b.heights);
}

const mon = PLANETS.find((p) => p.id === 'monument');
const rawDir = mon?.dem ? join(REPO, 'public', mon.dem.url.replace(/^\//, '')) : '';
const haveMonument = !!mon?.dem && existsSync(join(rawDir, 'base16.raw'));
const monument = (T: typeof Terrain): Terrain => {
  const d = mon!.dem!;
  const raw = readFileSync(join(rawDir, 'base16.raw'));
  const meta = JSON.parse(readFileSync(join(rawDir, 'base.json'), 'utf8'));
  const t = new T(mon!);
  const patch = makeDemPatch(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, meta, { size: d.size, lift: d.lift, feather: d.feather ?? 0 });
  t.demDetail = d.detail ?? 0;
  t.dem = patch;
  t.minH = patch.minHeight + patch.lift;
  t.maxH = patch.maxHeight + patch.lift;
  t.floor = t.minH - 30;
  return t;
};
const CHUNKS: [number, number][] = [
  [0, 0],
  [-1, 2],
  [3, -2],
  [-4, -1],
  [2, 5],
  [-3, 4],
];

// ---------------------------------------------------------------- 1. Monument with a base family

const worlds = groundWorlds();
const lentName = ['lok', 'tatooine', 'naboo', ...worlds].find((w) => worlds.includes(w) && existsSync(join(PACKS, w, 'terrain', 'shaders.json')));
if (!haveMonument) note('no Monument raster in this checkout: its halves are skipped');
else if (!lentName) note(`no converted world under ${PACKS} to lend its families: the base family half is skipped`);
else {
  const dir = join(PACKS, lentName);
  const asked: string[] = [];
  const bytes = async (rel: string): Promise<ArrayBuffer | null> => {
    asked.push(rel);
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const trn = (await bytes('terrain.trn'))!;
  const table = await SwgTerrain.create(trn, [], 0, 0, bytes, { tableOnly: true });
  // The table-only read, held on a pack that has bitmap families (a pack with none would fetch none either way).
  const withBitmaps = ['tatooine', 'mustafar', ...worlds].find((w) => worlds.includes(w) && existsSync(join(PACKS, w, 'terrain.trn')) && bitmapFiles(parseTerrainTemplate(new Uint8Array(readFileSync(join(PACKS, w, 'terrain.trn'))))).length > 0);
  if (withBitmaps) {
    const bdir = join(PACKS, withBitmaps);
    const bAsked: string[] = [];
    const bBytes = async (rel: string): Promise<ArrayBuffer | null> => {
      bAsked.push(rel);
      const f = join(bdir, rel);
      if (!existsSync(f)) return null;
      const b = readFileSync(f);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const btrn = readFileSync(join(bdir, 'terrain.trn'));
    const nBitmaps = bitmapFiles(parseTerrainTemplate(new Uint8Array(btrn))).length;
    const btable = await SwgTerrain.create(btrn.buffer.slice(btrn.byteOffset, btrn.byteOffset + btrn.byteLength) as ArrayBuffer, [], 0, 0, bBytes, { tableOnly: true });
    ok(nBitmaps > 0 && btable.tableOnly && !bAsked.some((a) => !a.endsWith('.json')), `a lent table (${withBitmaps}'s, whose terrain names ${nBitmaps} bitmap families) is read for its families alone: no worker and none of its bitmaps fetched (asked: ${bAsked.join(', ') || 'nothing'})`);
    btable.dispose();
  } else note('no converted world with bitmap families on disk: the table-only read is not held on one');
  const group = table.template.generator.shaderGroup;
  const byName = new Map<string, number>();
  for (const f of group.families.values()) {
    byName.set(f.name, f.id);
    byName.set(f.name.toLowerCase(), f.id);
  }
  const base = [...group.families.values()].find((f) => f.children.length >= 3) ?? [...group.families.values()][0];
  const file = JSON.parse(readFileSync(join(dir, 'terrain', 'shaders.json'), 'utf8')) as { version?: number; families: ShaderFamilyDef[] };
  const families = file.families.filter((x) => x.children?.length);
  const entries = tileEntries(families, false);
  const arrays = assembleTileArrays(families, entries, entries.map(() => true), 1, { colour: () => [0, 0, 0, 255], normal: () => null, gloss: () => null })!;
  const planetFams = new Map<number, string>([...group.families.values()].map((x) => [x.id, x.name]));
  const { childLayers, priority } = tileLookups(planetFams, families, arrays.childLayersByName);
  const t = monument(Terrain);
  t.demLent = table;
  const shader = new DemShader({ pack: lentName, fallback: base.name, rules: [] }, byName, t.dem!.lift, 4);
  shader.baseId = base.id;
  t.demShader = shader;
  t.tiler = makeTiler(childLayers, priority, group, false) as unknown as ChunkTiler;
  ok(t.tiled, `Monument with a world row naming ${lentName}:${base.name} as its base is drawn by the tile program`);
  const own = new Set(childLayers.get(base.id) ?? []);
  let tiledShape = true;
  let onlyBase = true;
  let white = true;
  const seen = new Set<number>();
  for (const [cx, cz] of CHUNKS) {
    const c = t.buildChunk(cx, cz);
    const layers = c.geometry.getAttribute('aGroundLayers') as THREE.BufferAttribute | undefined;
    const tint = c.geometry.getAttribute('aGroundTint') as THREE.BufferAttribute | undefined;
    if (!layers || !tint || c.geometry.getAttribute('aFamily')) {
      tiledShape = false;
      continue;
    }
    for (let i = 0; i < layers.array.length; i++) {
      seen.add(layers.array[i]);
      if (!own.has(layers.array[i])) onlyBase = false;
    }
    for (let i = 0; i < tint.array.length; i++) if (tint.array[i] !== 255) white = false;
  }
  ok(tiledShape, 'every chunk carries the tile program\'s bytes (layers, codes, tint) and none of the family attributes of before');
  ok(onlyBase && seen.size > 1, `every layer drawn is one of ${base.name}'s own alternates in the lent pack's tiler, ${seen.size} of them across six chunks (each sample's own choice)`);
  ok(white, 'and with no wash its tint is white');
  const surface = base.surface || null;
  let feet = true;
  t.buildChunk(0, 0);
  for (let i = 0; i < 40; i++) if (t.surfaceAt(1 + i * 1.5, 2 + i * 1.4) !== surface) feet = false;
  ok(feet, `the feet read the base family's own surface (${surface ?? 'none named'})`);
  // A painted cell, its alternate forced.
  const second = [...group.families.values()].find((f) => f.id !== base.id && f.children.length >= 2) ?? base;
  const paint = new GroundPaint();
  paint.resolve([{ pack: lentName, name: second.name, child: 1 }], group, lentName);
  for (let cz = 0; cz < 4; cz++) for (let cx = -4; cx < 0; cx++) cellPaint(paint, cx, cz, 1);
  shader.paint = paint;
  ok(shader.familyAt(6, 6, () => 0) === second.id && shader.familyAt(-60, 60, () => 0) === base.id, `a painted cell lays ${second.name} where it is painted (game 6, 6: raw -6, 6) and the base elsewhere`);
  const c = t.buildChunk(0, 0);
  const layers = c.geometry.getAttribute('aGroundLayers') as THREE.BufferAttribute;
  const pos = c.geometry.getAttribute('position') as THREE.BufferAttribute;
  const want = (childLayers.get(second.id) ?? [])[childIndexOf(second, paint.choiceOf[1])];
  // Every triangle of a tile whose four corners are painted (game x 4 to 16, z 0 to 12: raw -4 to -16): its one layer is
  // the forced alternate's, never the alternate the pole's own choice would pick.
  let inside = 0;
  let forcedRight = true;
  for (let tri = 0; tri < pos.count; tri += 3) {
    const x = (pos.getX(tri) + pos.getX(tri + 1) + pos.getX(tri + 2)) / 3;
    const z = (pos.getZ(tri) + pos.getZ(tri + 1) + pos.getZ(tri + 2)) / 3;
    if (!(x > 4 && x < 16 && z > 0 && z < 12)) continue;
    inside++;
    if (layers.getX(tri) !== want) forcedRight = false;
  }
  const alternates = new Set((childLayers.get(second.id) ?? []).filter((_, k) => second.children[k]?.weight > 0));
  ok(forcedRight && inside > 20 && alternates.size > 1 && childIndexOf(second, paint.choiceOf[1]) === 1, `and every one of the ${inside} triangles inside the painted cells draws it in the alternate the cell forces (layer ${want}), of the ${alternates.size} it has`);
  ok(t.familyAt(6, 6) === second.id, 'the feet read the painted family there');
}

// ---------------------------------------------------------------- 2. Monument with no world row

if (haveMonument) {
  const old = await loadOld<{ Terrain: typeof Terrain }>(['src/world/terrain.ts'], 'src/world/terrain.ts');
  const t = monument(Terrain);
  ok(!t.tiled, 'Monument with no world row is not tiled');
  if (old) {
    const a = monument(old.Terrain);
    let failed = '';
    for (const [cx, cz] of CHUNKS) if (!sameChunk(a.buildChunk(cx, cz), t.buildChunk(cx, cz))) failed ||= `${cx},${cz}`;
    ok(!failed, `and its six chunks are e6c2578's, every attribute by Object.is (the plain shape)${failed ? `: first apart ${failed}` : ''}`);
    ok(!t.buildChunk(0, 0).geometry.getAttribute('aGroundLayers'), 'carrying no tile bytes, so the material of before draws it');
  } else note('git cannot hand e6c2578 over here: the no-row comparison is skipped');
}

// ---------------------------------------------------------------- 3. a synthetic ruled world sculpted

{
  const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;
  const n = 65;
  const hs = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = Math.round(20000 + 15000 * Math.sin(i * 0.31) * Math.cos(j * 0.23));
  const meta = { mapWidthInMeters: 1024, base: { samples: n, metresPerSample: 16, minHeight: 0, maxHeight: 400 } };
  const t = new Terrain(planet);
  t.dem = makeDemPatch(hs.buffer.slice(0) as ArrayBuffer, meta, { size: 1024, lift: 0, feather: 0 });
  t.minH = 0;
  t.maxH = 400;
  t.demShader = new DemShader({ pack: 'test', fallback: 'sand', rules: [{ family: 'snow', aboveElevation: 250 }, { family: 'rock', aboveSlope: 30 }] }, new Map([['sand', 1], ['rock', 2], ['snow', 3]]), 0);
  t.tiler = { rank: (f: number) => f, layer: (f: number) => f, corners: [0, 1, 2, 3], census: new Float64Array(5), setWeights: () => {} } as unknown as ChunkTiler;
  const store = new HeightEdits();
  t.heights = store;
  ok(t.tiled, 'a ruled real-elevation world with a tiler is drawn by the tile program');
  const standing = t.buildChunk(0, 0);
  const famsBefore: number[] = [];
  for (let z = 1; z < CHUNK_SIZE; z += 2) for (let x = 1; x < CHUNK_SIZE; x += 2) famsBefore.push(t.familyAt(x, z) ?? -1);
  // A sculpt: the chunk raised 300 m, in the raw frame (x mirrored), past the snow line.
  for (let tz = -1; tz <= 1; tz++) {
    for (let tx = -2; tx <= 0; tx++) {
      const d = store.writable(tx, tz)!;
      d.fill(300);
    }
  }
  ok(t.rewriteChunk(0, 0, standing.geometry, standing.heights), 'the sculpted chunk is written again in place');
  const famsInPlace: number[] = [];
  for (let z = 1; z < CHUNK_SIZE; z += 2) for (let x = 1; x < CHUNK_SIZE; x += 2) famsInPlace.push(t.familyAt(x, z) ?? -1);
  const fresh = t.buildChunk(0, 0);
  const famsFresh: number[] = [];
  for (let z = 1; z < CHUNK_SIZE; z += 2) for (let x = 1; x < CHUNK_SIZE; x += 2) famsFresh.push(t.familyAt(x, z) ?? -1);
  ok(sameChunk(standing, fresh) && famsInPlace.every((f, i) => f === famsFresh[i]), "its rewritten tile bytes and family grid are a fresh build's, by Object.is");
  const moved = famsBefore.filter((f, i) => f !== famsInPlace[i]).length;
  ok(moved > 0, `and the rules read the edited ground: ${moved} of ${famsBefore.length} family samples moved with the height`);
  // A ruled world with a world row's base: where no rule holds, the base, never the rules' own fallback.
  const ruled = new DemShader({ pack: 'test', fallback: 'sand', rules: [{ family: 'snow', aboveElevation: 250 }] }, new Map([['sand', 1], ['rock', 2], ['snow', 3]]), 0);
  ruled.baseId = 2;
  let low = 0;
  let high = 0;
  let baseRight = true;
  for (let i = 0; i < 400; i++) {
    const x = ((i * 37) % 900) - 450;
    const z = ((i * 53) % 900) - 450;
    const h = (i * 7) % 500;
    const f = ruled.familyAt(x, z, () => h);
    if (h > 250) {
      high++;
      if (f !== 3) baseRight = false;
    } else if (h < 250) {
      low++;
      if (f !== 2) baseRight = false;
    }
  }
  ok(baseRight && low > 50 && high > 50, `on a ruled world whose row names a base, every sample no rule holds takes the base (${low}) and every one a rule holds the rule's family (${high})`);
}

console.log(`\ndemTiles: ${checks} checks passed`);
