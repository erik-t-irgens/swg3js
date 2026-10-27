// The paint's preview (Map-maker II, DESIGN.md §2.5, W2): while a stroke is held the paint is laid in place over the
// cached blocks under it (`SwgTerrain.previewPaint`, `TerrainSampler.previewPaint`) and the chunks standing there are
// written again in place (`Terrain.rewriteChunk`); when the stroke is let go the blocks are made again with the paint
// (`SwgTerrain.repaint`). Held here, on the made terrain and on converted worlds with the pack's own tiler:
//
//   - with `follow` off the preview is exactly the ground the made-again blocks build: every attribute of the chunk the
//     preview wrote in place (its tile bytes, codes, tint and heights) and its family grid equal a fresh build after the
//     blocks land, by `Object.is`;
//   - with `follow` on the in-place rewrite after the blocks land equals a fresh build too, and where a world's own
//     filters answer the paint (its plants, a family a filter lays) the preview can only be the end of it, which is said;
//   - a stamp laid twice lays the same (the preview starts from the block as the stroke found it), and the preview's kept
//     ground goes when the blocks are made again;
//   - what lands is held to a terrain of its own made over a copy of the paint with nothing cached (never only to a fresh
//     build out of the same cache): the chunk and its family grid, the far grid cached over the stroke (the world told of
//     it), and a row of cells erased, whose poles are the unpainted ground's family again;
//   - a colour stroke over colours already painted previews the landed tint value for value (the paint laid over the
//     colours the affectors left, which a block made under painted colours keeps beside it);
//   - a repaint over a cell's corner alone asks again the block whose last poles it reaches, and a landing that takes the
//     palette and a tile out together (an undo of a stroke that added the palette's entry) makes the ground under the tile
//     the unpainted ground's again.
//
// Run: node tools/swg/tests/paintPreview.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GroundPaint, paintTileNumber } from '../../../src/swg/terrain/groundPaint.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { CHUNK_SIZE, Terrain, type ChunkTiler } from '../../../src/world/terrain.ts';
import { assembleTileArrays, makeTiler, tileEntries, tileLookups, type ShaderFamilyDef } from '../../../src/world/terrainTextures.ts';
import type { PlanetDef } from '../../../src/data/planets.ts';
import { cellPaint, colourCell, paintTerrainBytes } from './paintHarness.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null } as unknown as PlanetDef;

/** How many values of every attribute and the heights differ between two chunks (-1 where their shapes differ). */
function apart(a: THREE.BufferGeometry, ah: Float32Array, b: THREE.BufferGeometry, bh: Float32Array): number {
  const ka = Object.keys(a.attributes).sort();
  if (ka.join() !== Object.keys(b.attributes).sort().join()) return -1;
  let n = 0;
  for (const k of ka) {
    const x = (a.attributes[k] as THREE.BufferAttribute).array;
    const y = (b.attributes[k] as THREE.BufferAttribute).array;
    if (x.length !== y.length) return -1;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) n++;
  }
  for (let i = 0; i < ah.length; i++) if (!Object.is(ah[i], bh[i])) n++;
  return n;
}
/** A chunk's family grid as the feet read it, at every 2 m of the chunk. */
function familiesOf(t: Terrain, cx: number, cz: number): number[] {
  const out: number[] = [];
  for (let z = 1; z < CHUNK_SIZE; z += 2) for (let x = 1; x < CHUNK_SIZE; x += 2) out.push(t.familyAt(cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z) ?? -1);
  return out;
}

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

/** A copy of a paint (its tiles, palette and follow), shared with nothing. */
function copyOf(p: GroundPaint): GroundPaint {
  const q = new GroundPaint(p.cell);
  q.take(p.message(null, null, true));
  return q;
}

/** A chunk and a far grid built afresh from a terrain of their own over a copy of the paint: what the ground must land as. */
async function truth(trn: ArrayBuffer, centre: { x: number; z: number }, fetchBytes: (f: string) => Promise<ArrayBuffer | null>, paint: GroundPaint, tiler: (swg: SwgTerrain) => ChunkTiler | null, cx0: number, cz0: number, far: { gx0: number; gz0: number; size: number; res: number }) {
  const swg = await SwgTerrain.create(trn, [], centre.x, centre.z, fetchBytes, { paint: copyOf(paint) });
  const t = new Terrain(planet);
  t.attachSwg(swg);
  t.tiler = tiler(swg);
  t.prepareChunk(cx0, cz0, true);
  const chunk = t.buildChunk(cx0, cz0);
  const fams = familiesOf(t, cx0, cz0);
  const farGrid = swg.farGrid(far.gx0, far.gz0, far.size, far.res, true)!;
  swg.dispose();
  return { chunk, fams, farGrid };
}

/** How many values of a far grid's samples differ from another's. */
function farApart(a: { heights: Float32Array; shaders: Int32Array; children: Uint8Array; colors: Uint8Array }, b: { heights: Float32Array; shaders: Int32Array; children: Uint8Array; colors: Uint8Array }): number {
  let n = 0;
  for (const k of ['heights', 'shaders', 'children', 'colors'] as const) {
    const x = a[k];
    const y = b[k];
    if (x.length !== y.length) return -1;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) n++;
  }
  return n;
}

/** One stroke's preview and its landing on a chunk, the paint `follow` as given. */
async function stroke(name: string, trn: ArrayBuffer, cx0: number, cz0: number, pack: string, tiler: (swg: SwgTerrain) => ChunkTiler | null, follow: boolean, fetchBytes: (f: string) => Promise<ArrayBuffer | null>, centre: { x: number; z: number }): Promise<void> {
  const paint = new GroundPaint();
  paint.follow = follow;
  const swg = await SwgTerrain.create(trn, [], centre.x, centre.z, fetchBytes, {
    paint,
    paintResolve: (group) => {
      const fams = [...group.families.values()].filter((f) => f.children.length);
      paint.resolve(fams.slice(0, 3).map((f, i) => (i === 2 && f.children.length > 2 ? { pack, name: f.name, child: 2 } : { pack, name: f.name })), group, pack);
    },
  });
  const terrain = new Terrain(planet);
  terrain.attachSwg(swg);
  terrain.tiler = tiler(swg);
  terrain.prepareChunk(cx0, cz0, true);
  const standing = terrain.buildChunk(cx0, cz0);
  // A far grid over the stroke, cached before it: made again with the paint as the stroke is let go.
  const far = { gx0: cx0 * CHUNK_SIZE, gz0: cz0 * CHUNK_SIZE, size: 64, res: 4 };
  const farBefore = swg.farGrid(far.gx0, far.gz0, far.size, far.res, true)!;
  const landedFar: string[] = [];
  swg.onRepainted = (kind) => landedFar.push(kind);
  // The stroke: a stripe of each entry and a colour over the chunk's middle, in the raw frame.
  const g0x = cx0 * CHUNK_SIZE + 12;
  const g0z = cz0 * CHUNK_SIZE + 12;
  const rx0 = swg.toSwgX(g0x + 40);
  const rz0 = swg.toSwgZ(g0z);
  const c0x = Math.floor(rx0 / 4);
  const c0z = Math.floor(rz0 / 4);
  for (let cz = c0z; cz < c0z + 10; cz++) for (let cx = c0x; cx < c0x + 10; cx++) cellPaint(paint, cx, cz, 1 + ((cx + 2 * cz) % 3 + 3) % 3);
  for (let cx = c0x; cx < c0x + 10; cx += 3) colourCell(paint, cx, c0z + 4, 180, 30, 200, 220);
  const laid = swg.previewPaint(g0x, g0z, g0x + 40, g0z + 40);
  const laidAgain = swg.previewPaint(g0x, g0z, g0x + 40, g0z + 40);
  ok(laid > 0 && laid === laidAgain, `${name}, follow ${follow ? 'on' : 'off'}: the preview lays the paint over the ${laid} cached blocks the stroke reaches, and a stamp laid twice lays the same blocks`);
  ok(terrain.rewriteChunk(cx0, cz0, standing.geometry, standing.heights), 'and the standing chunk is written again in place from them');
  const previewFams = familiesOf(terrain, cx0, cz0);
  const once = { geometry: standing.geometry.clone(), heights: standing.heights.slice() };
  swg.previewPaint(g0x, g0z, g0x + 40, g0z + 40);
  terrain.rewriteChunk(cx0, cz0, standing.geometry, standing.heights);
  ok(apart(once.geometry, once.heights, standing.geometry, standing.heights) === 0, 'a stamp laid over a preview again rewrites the chunk to the same bytes');
  // The stroke let go: its blocks made again (no worker in node: at once), and the chunk built afresh.
  ok(swg.sampler.previewBlocks > 0, `the preview keeps the ground it found (${swg.sampler.previewBlocks} blocks)`);
  const asked = swg.repaint(rx0 - 40, rz0, rx0 + 40, rz0 + 40);
  ok(asked > 0 && swg.sampler.previewBlocks === 0, `letting go makes the ${asked} grids under it again and lets the preview's kept ground go`);
  const fresh = terrain.buildChunk(cx0, cz0);
  const freshFams = familiesOf(terrain, cx0, cz0);
  const differ = apart(standing.geometry, standing.heights, fresh.geometry, fresh.heights);
  const famsApart = previewFams.filter((f, i) => f !== freshFams[i]).length;
  if (!follow) ok(differ === 0 && famsApart === 0, `${name}, follow off: the chunk the preview wrote in place is the fresh build after the blocks land, every attribute (tile bytes, codes, tint, heights) and its family grid by Object.is`);
  else note(`${name}, follow on: the preview differs from the landed ground in ${differ} attribute values and ${famsApart} of ${previewFams.length} family samples (what the world's own filters made of the paint)`);
  terrain.rewriteChunk(cx0, cz0, standing.geometry, standing.heights);
  const after = familiesOf(terrain, cx0, cz0);
  ok(apart(standing.geometry, standing.heights, fresh.geometry, fresh.heights) === 0 && after.every((f, i) => f === freshFams[i]), `${name}, follow ${follow ? 'on' : 'off'}: once the blocks land, the chunk written again in place is the fresh build, attribute for attribute and its family grid`);
  // Held to a terrain of its own, made over a copy of the paint with nothing cached: what the ground must land as.
  const t1 = await truth(trn, centre, fetchBytes, paint, tiler, cx0, cz0, far);
  ok(apart(standing.geometry, standing.heights, t1.chunk.geometry, t1.chunk.heights) === 0 && after.every((f, i) => f === t1.fams[i]), `${name}, follow ${follow ? 'on' : 'off'}: and it is the ground a terrain of its own makes with the paint, nothing cached (every attribute and the family grid)`);
  const farNow = swg.farGrid(far.gx0, far.gz0, far.size, far.res, true)!;
  const farMoved = farApart(farBefore, t1.farGrid);
  ok(farMoved > 0 && farApart(farNow, t1.farGrid) === 0 && farNow !== farBefore && landedFar.includes('far'), `${name}, follow ${follow ? 'on' : 'off'}: the far grid cached over the stroke is made again with the paint (${farMoved} of its values moved), the far grid a terrain of its own makes, and the world is told of it`);
  // A row of cells erased: the preview cannot show the ground under it, the landing does.
  for (let cx = c0x; cx < c0x + 10; cx++) cellPaint(paint, cx, c0z + 1, 0);
  swg.previewPaint(g0x, g0z, g0x + 40, g0z + 40);
  terrain.rewriteChunk(cx0, cz0, standing.geometry, standing.heights);
  const stillShown = familiesOf(terrain, cx0, cz0);
  swg.repaint(rx0 - 40, rz0, rx0 + 40, rz0 + 40);
  terrain.rewriteChunk(cx0, cz0, standing.geometry, standing.heights);
  const landedFams = familiesOf(terrain, cx0, cz0);
  const t2 = await truth(trn, centre, fetchBytes, paint, tiler, cx0, cz0, far);
  const movedAtLanding = stillShown.filter((f, i) => f !== landedFams[i]).length;
  ok(apart(standing.geometry, standing.heights, t2.chunk.geometry, t2.chunk.heights) === 0 && landedFams.every((f, i) => f === t2.fams[i]) && movedAtLanding > 0, `${name}, follow ${follow ? 'on' : 'off'}: a row of cells erased shows once its blocks are made again, the ground a terrain of its own makes with the paint (${movedAtLanding} family samples moved at the landing)`);
  // The erased cells' poles are the ground's own again: with follow off every pole of them takes the family an unpainted
  // terrain gives it (with it on, a family the world's own filters laid on a painted neighbour may reach them by a snap).
  const plainSwg = await SwgTerrain.create(trn, [], centre.x, centre.z, fetchBytes, {});
  let erased = 0;
  let back = 0;
  let wasPainted = 0;
  for (let cx = c0x; cx < c0x + 10; cx++) {
    for (const rx of [cx * 4 - 2, cx * 4]) {
      for (const rz of [(c0z + 1) * 4 - 2, (c0z + 1) * 4]) {
        erased++;
        const own = plainSwg.sampler.shaderAt(rx, rz);
        if (swg.sampler.shaderAt(rx, rz) === own) back++;
        if (paint.familyOf[1 + ((cx + 2 * (c0z + 1)) % 3 + 3) % 3] !== own) wasPainted++;
      }
    }
  }
  plainSwg.dispose();
  if (!follow) ok(back === erased && erased === 40 && wasPainted > 0, `${name}, follow off: the ${erased} poles of the erased cells are the unpainted ground's family again (${wasPainted} of them had been painted another)`);
  else note(`${name}, follow on: ${back} of the ${erased} poles of the erased cells are the unpainted ground's family again`);
  // A colour stroke over colours already painted (the blocks were made with them): the preview lays the paint over the
  // ground's own colours, so the tint it shows is the landed ground's, never the paint laid twice.
  for (let cx = c0x; cx < c0x + 10; cx++) colourCell(paint, cx, c0z + 4, 20, 210, 40, 150);
  for (let cx = c0x; cx < c0x + 10; cx += 2) colourCell(paint, cx, c0z + 5, 240, 220, 10, 255);
  const blk = swg.sampler.generateBlock(Math.floor((4 * c0x + 18) / 64), Math.floor((4 * c0z + 16) / 64));
  ok(!!blk.colorsUnpainted, `${name}: a block made under painted colours keeps its colours as the affectors left them beside it`);
  swg.previewPaint(g0x, g0z, g0x + 40, g0z + 40);
  terrain.rewriteChunk(cx0, cz0, standing.geometry, standing.heights);
  const t3 = await truth(trn, centre, fetchBytes, paint, tiler, cx0, cz0, far);
  const tintApart = apartAttr(standing.geometry, t3.chunk.geometry, 'aGroundTint');
  if (!follow) ok(tintApart === 0, `${name}, follow off: a colour stroke over colours already painted previews the tint the landed ground carries, value for value (the paint laid once, over the ground's own colours)`);
  else note(`${name}, follow on: the colour preview differs from the landed tint in ${tintApart} values (what the world's own filters made of the paint)`);
  swg.repaint(rx0 - 40, rz0, rx0 + 40, rz0 + 40);
  swg.dispose();
}

/** How many values of one attribute differ between two geometries (-1 where it is missing or of another length). */
function apartAttr(a: THREE.BufferGeometry, b: THREE.BufferGeometry, name: string): number {
  const x = (a.getAttribute(name) as THREE.BufferAttribute | undefined)?.array;
  const y = (b.getAttribute(name) as THREE.BufferAttribute | undefined)?.array;
  if (!x || !y || x.length !== y.length) return -1;
  let n = 0;
  for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) n++;
  return n;
}

const made = paintTerrainBytes();
const madeBuf = made.slice().buffer;
const standIn = (): ChunkTiler => ({ rank: (f: number) => f, layer: (f: number) => f, corners: [0, 1, 2, 3], census: new Float64Array(5), setWeights: () => {} }) as unknown as ChunkTiler;
for (const follow of [false, true]) await stroke('the made terrain', madeBuf, 0, 0, 'test', standIn, follow, async () => null, { x: 0, z: 0 });

{
  // A repaint whose rectangle is a cell on a block's edge: a colour cell at raw x 516 reaches the poles of block 7 (its
  // last at x 514) though the rectangle, its corner alone, is past them. The repaint's margin asks block 7 again.
  const paint = new GroundPaint();
  const swg = await SwgTerrain.create(madeBuf, [], 0, 0, async () => null, { paint, paintResolve: (g) => paint.resolve([{ pack: 'test', name: 'grass' }], g, 'test') });
  const s = swg.sampler;
  s.generateBlock(7, 0);
  s.generateBlock(8, 0);
  colourCell(paint, 129, 2, 250, 10, 10, 255);
  swg.repaint(516, 8, 516, 8);
  const b7 = s.generateBlock(7, 0);
  const st = s.blockStart(7, 0);
  const k = (((8 - st.z) / 2) * s.numberOfPoles + (514 - st.x) / 2) * 3;
  swg.dispose();
  ok(b7.colors[k] !== 255 && b7.colors[k + 1] !== 255, `a repaint over a cell's corner alone asks again the block whose last poles it reaches (block 7, pole x 514: ${b7.colors[k]}, ${b7.colors[k + 1]}, ${b7.colors[k + 2]})`);
}

{
  // A landing that takes the palette and a tile out together (an undo of a stroke that added the palette's entry): the
  // ground under the tile taken out is made again, the unpainted ground's, though the palette moved too.
  const paint = new GroundPaint();
  const swg = await SwgTerrain.create(madeBuf, [], 0, 0, async () => null, { paint, paintResolve: (g) => paint.resolve([{ pack: 'test', name: 'grass' }], g, 'test') });
  const plainS = await SwgTerrain.create(madeBuf, [], 0, 0, async () => null, {});
  const s = swg.sampler;
  for (let cz = 2; cz < 12; cz++) for (let cx = 2; cx < 12; cx++) cellPaint(paint, cx, cz, 1);
  for (let cz = 2; cz < 12; cz++) colourCell(paint, 4, cz, 10, 200, 30, 220);
  s.generateBlock(0, 0);
  const painted = s.generateBlock(0, 0);
  const plainB = plainS.sampler.generateBlock(0, 0);
  const differs = painted.shaders.some((v, i) => v !== plainB.shaders[i]) && painted.colors.some((v, i) => v !== plainB.colors[i]);
  // The undo: the tiles taken out, the palette emptied, and the landing.
  paint.setFamilyTile(0, 0, null);
  paint.setColourTile(0, 0, null);
  paint.resolve([], swg.template.generator.shaderGroup, 'test');
  const asked = swg.landPaint(true, [], [], { x0: 0, z0: 0, x1: 512, z1: 512 });
  const after = s.generateBlock(0, 0);
  const same = after.shaders.every((v, i) => v === plainB.shaders[i]) && after.colors.every((v, i) => v === plainB.colors[i]) && after.children.every((v, i) => v === plainB.children[i]);
  ok(differs && asked > 0 && same, `a landing that takes the palette and a tile out together makes the ground under the tile again (${asked} grids): its families, alternates and colours the unpainted ground's`);
  // And with a palette left and a tile taken out, the same.
  for (let cz = 2; cz < 12; cz++) for (let cx = 2; cx < 12; cx++) cellPaint(paint, cx, cz, 1);
  paint.resolve([{ pack: 'test', name: 'grass' }], swg.template.generator.shaderGroup, 'test');
  swg.landPaint(true, [], [], { x0: 0, z0: 0, x1: 512, z1: 512 });
  const repainted = s.generateBlock(0, 0);
  paint.setFamilyTile(0, 0, null);
  swg.landPaint(false, [paintTileNumber(0, 0)], [], { x0: 0, z0: 0, x1: 512, z1: 512 });
  const again = s.generateBlock(0, 0);
  ok(repainted.shaders.some((v, i) => v !== plainB.shaders[i]) && again.shaders.every((v, i) => v === plainB.shaders[i]), 'and a tile taken out with the palette left as it was is made again the same way');
  swg.dispose();
  plainS.dispose();
}

const worlds = groundWorlds();
for (const world of ['yavin4', 'tatooine'].filter((w) => worlds.includes(w))) {
  const dir = join(PACKS, world);
  const bytes = (rel: string): ArrayBuffer | null => {
    const f = join(dir, rel);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(join(dir, 'layout.json'), 'utf8').slice(0, 8000));
  const centre = m ? { x: Number(m[1]), z: Number(m[2]) } : { x: 0, z: 0 };
  for (const follow of [false, true]) await stroke(world, bytes('terrain.trn')!, 3, -2, world, (swg) => packTiler(world, swg) ?? standIn(), follow, async (f) => bytes(f), centre);
}
if (!worlds.length) note(`no converted worlds under ${PACKS}: held on the made terrain alone`);

console.log(`\npaintPreview: ${checks} checks passed`);
