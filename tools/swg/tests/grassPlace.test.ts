// The grass and the far tree cards placed (materials and ground pass, waves 5b and 5c).
//
// Placing reads the generator's radial maps out of cached blocks only and writes one chunk's tufts into its
// buffers (`grassMath.ts`); the grass field builds a window of chunks round the eye and does nothing on a frame
// that crosses none (`grass.ts`). The checks:
//
//   1. a terrain built in memory, stood up as the game stands one (`SwgTerrain`), on hills of a fractal and under
//      a colour map that changes across the chunk: every tuft of a chunk is the one worked out here from scratch --
//      the tile's own generator, its jittered point, the pole's own family, the child, its size, its picture's
//      layer, and where it stands: the ground's own height at its foot (the fans), the ground's normal at the pole
//      from its neighbours turned into the game's frame, and the colour map's bytes there -- and only those; the
//      generator's exclusion, a circle, the drawn water and a remove-all each drop what they should and nothing
//      else; a child meant for water is kept under it; and on a second terrain whose near tiling has no border of
//      its own, the floor of ours stands in for it
//   2. the far tree cards of a far tile, likewise from scratch, from a coarse grid generated here in the terrain's
//      own frame: each card's family the nearest sample's, its height the samples' bilinear one less the far
//      ground's drop, its tint the sample's colour; the far grid's own map is that grid mirrored into the game's
//      frame; and a far lake and a circle drop what they should
//   3. a far card stands only where our own trees are not: hidden as it is built over a chunk that stands with its
//      trees shown, shown and lifted onto the coarse height over one whose trees a short Tree distance hides, and
//      hidden and shown again as chunks come and go (`chunksChanged`), its attribute marked for upload; a tile's mesh
//      hangs the casting depth material and casts by `applyCast` when the far cards are switched to
//   4. nothing is generated on this thread: with every block cached no block is generated and no height asked
//      for, and with none cached the chunk places nothing and generates nothing
//   5. the window: built round the eye, a chunk a frame nearest first, taken down as it leaves; a circle added
//      builds the chunks under it again; and a frame that crosses no chunk makes nothing (measured on the young
//      generation, with --expose-gc)
//   5b. a chunk built through the field hangs the casting depth material and the field's own shadow hooks, which
//      draw no tuft into a cascade past the count in force; and the window follows the page's grass distance
//   6. the converted worlds (SWG3JS_PACKS, else assets-private), over chunks drawn at random: every tuft stands at
//      the ground's own height at its foot; the share of the candidates that find a near family is the share of
//      the very same chunks' poles that hold one; and it is the study's own share of poles over 2,000 random
//      blocks, within what the two samples' spread allows
//
// Run: node --expose-gc tools/swg/tests/grassPlace.test.ts
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { constants as perfConstants, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import * as THREE from 'three';
import { form, chunk, W, encode, ihdr, mfrc } from './iffWriter.ts';
import { afd, header, rfam } from './radialFixture.ts';
import { FastRandomGenerator, hashTuple, type RadialChild } from '../../../src/swg/terrain/flora.ts';
import { shaderKey } from '../../../src/swg/terrain/shaderKey.ts';
import { readRadialFile, type RadialShaderEntry } from '../../../src/swg/terrain/radialFile.ts';
import { ORIGIN_OFFSET } from '../../../src/swg/terrain/trn.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';
import { FAR_CARD_DEFAULTS, GRASS_DEFAULTS, GRASS_SHADOW_DEFAULTS, GRASS_SHADOW_TUNE, GRASS_SWAY_DEFAULTS, MEANT_FOR_WATER, TUFT_FAR, TUFT_HIDDEN, TUFT_LIFT, TUFT_PLUS, candidateCapacity, placeFarCards, placeGrass, placeStats, tuftBuffers, type FarSamples, type FloraCircle, type GrassWorld } from '../../../src/world/grassMath.ts';
import { CHUNK_TREES, GrassField, FarCards, GRASS_CAST, GRASS_TUNE, grassDepthMaterial, grassMaterial, setGrassTune, type GrassHost, type GrassSetup } from '../../../src/world/grass.ts';
import { SWAY_DEFAULTS } from '../../../src/world/swayMath.ts';
import { groundChunkOrigin } from '../../../src/world/groundTiles.ts';
import { groundWorlds, PACKS } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);

const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));
const rect = (x0: number, z0: number, x1: number, z1: number, water = 0) =>
  form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(water ? 1 : 0).i32(0).f32(water).f32(2).str(water ? 'wter_test' : '').i32(0).bytes())));
const circle = (x: number, z: number, r: number, feather = 0) => form('BCIR', form('0002', ihdr('circle'), chunk('DATA', new W().f32(x).f32(z).f32(r).i32(0).f32(feather).bytes())));
const aexc = form('AEXC', form('0000', ihdr('exclude')));
const ahcn = (h: number) => form('AHCN', form('0000', ihdr('flat'), chunk('DATA', new W().i32(0).f32(h).bytes())));
const accn = (r: number, g: number, b: number) => form('ACCN', form('0000', ihdr('colour'), chunk('DATA', new W().i32(0).u8(r).u8(g).u8(b).bytes())));
// Hills: a fractal added over the whole map, six metres from its trough to its crest.
const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('hills').bytes()), mfrc(1337, { oct: 3, freq: 2, amp: 0.5, sx: 0.02, sy: 0.02 }))));
const ahfr = form('AHFR', form('0003', ihdr('hills'), form('DATA', chunk('PARM', new W().i32(1).i32(1).f32(6).bytes()))));

// The terrain file: hills everywhere, a colour map of two colours feathered into each other over the chunk, a
// meadow of three children painted everywhere at 0.6, a remove-all disc, an exclusion square, a lake (its ground
// held at nought under water at one metre), far trees everywhere, and a far lake far out over the far tile.
const rgrp = form('RGRP', form('0004',
  rfam(1, 'meadow', 1, [
    { shader: 'radl_grass_test', w: [0.5, 0.75], h: [1, 1.5], aspect: true, sway: [0.13, 0.3] },
    { shader: 'radl_flower_test', w: [0.4, 0.4], h: [0.6, 0.9], plus: true, align: true, weight: 0.5 },
    { shader: 'radl_uwtr_seagrass_test', w: [0.5, 0.5], h: [0.8, 0.8], weight: 0.5 },
  ]),
  rfam(2, 'far trees', 0.5, [{ shader: 'radl_far_tree_test', w: [8, 8], h: [20, 26] }]),
));
const tgen = form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008')), rgrp, form('EGRP', form('0002')), mgrp, form('MGRP', form('0000')), form('LYRS',
  layer('hills', ahfr),
  layer('meadow', rect(-2000, -2000, 2000, 2000), afd('AFDN', 1, 1, 0, 1, 0.6), afd('AFDF', 2), accn(90, 160, 60)),
  layer('dry patch', circle(-36, 40, 40, 1), accn(200, 170, 90)),
  layer('mown', circle(-30, 20, 9), afd('AFDN', 1, 1, 1)),
  layer('excluded', rect(-50, 40, -40, 50), aexc),
  layer('lake', rect(-20, 5, -8, 30, 1), ahcn(0)),
  layer('far lake', rect(-450, 250, -250, 450, 60)),
)));
const terrainOf = async (border: number) => SwgTerrain.create(encode(form('PTAT', form('0015', chunk('DATA', header(1, border)), tgen, form('BAKE')))).slice().buffer as ArrayBuffer, [], 0, 0, async () => null);
const swg = await terrainOf(0.42);
const shaders = new Map<string, RadialShaderEntry>([
  ['radl_grass_test', { layer: 0, near: true, far: false, alphaRef: 4, kind: 'plain', width: 256, height: 256 }],
  ['radl_flower_test', { layer: 1, near: true, far: false, alphaRef: 0, kind: 'plain', width: 256, height: 256 }],
  ['radl_uwtr_seagrass_test', { layer: 2, near: true, far: false, alphaRef: 1, kind: 'plain', width: 256, height: 256 }],
  ['radl_far_tree_test', { layer: 3, near: false, far: true, alphaRef: 32, kind: 'fade', width: 128, height: 256 }],
]);
const worldOf = (t: SwgTerrain): GrassWorld => {
  const keys = new Map<RadialChild, string>();
  for (const f of t.template.generator.radialGroup.families.values()) for (const c of f.children) keys.set(c, shaderKey(c.shader));
  return { group: t.template.generator.radialGroup, shaders, keyOf: (c) => keys.get(c)! };
};
const world = worldOf(swg);
const group = world.group;
const near = swg.template.flora.radial;
const far = swg.template.flora.farRadial;
ok(near.tileSize === 1 && Math.abs(near.tileBorder - 0.42) < 1e-6 && near.maximumDistance === 30 && far.tileSize === 32, 'the terrain says its own near tiling (0-30 m on 1 m tiles, 0.42 border) and far tiling (to 500 m on 32 m tiles)');
const f4 = (v: number) => Math.fround(v).toFixed(4);

// ---------------------------------------------------------------- 1. one chunk, from scratch

interface Worked {
  want: string[];
  water: number;
  wet: number;
  mown: number;
  excluded: number;
  circled: number;
}

/**
 * Every tuft the chunk at `o` holds on terrain `t`, worked out here from scratch: the tiles whose jittered point
 * (by `j`) falls in it, the pole each maps to found from the block's own layout (two poles of pad, 2 m apart), its
 * height the fans' at the point, its normal by central differences at the pole with x turned into the game's
 * frame, its tint the colour map's bytes there. A centre of nought, so the game's x is minus the terrain's.
 */
function fromScratch(t: SwgTerrain, o: { x: number; z: number }, j: number, circles: readonly FloraCircle[]): Worked {
  const sampler = t.sampler;
  const n = sampler.numberOfPoles;
  const out: Worked = { want: [], water: 0, wet: 0, mown: 0, excluded: 0, circled: 0 };
  for (let tz = Math.floor(o.z) - 2; tz <= Math.floor(o.z + 64) + 2; tz++) {
    for (let tx = Math.floor(-o.x - 64) - 2; tx <= Math.floor(-o.x) + 2; tx++) {
      const r = new FastRandomGenerator(hashTuple(tx * 1, tz * 1));
      const jx = r.randomFloat();
      const jz = r.randomFloat();
      const rc = r.randomFloat();
      const ry = r.randomFloat();
      const rw = r.randomFloat();
      const rh = r.randomFloat();
      const x = tx + 0.5 + (jx * 2 - 1) * j;
      const z = tz + 0.5 + (jz * 2 - 1) * j;
      const gx = -x;
      const gz = z;
      if (gx < o.x || gx >= o.x + 64 || gz < o.z || gz >= o.z + 64) continue;
      const bx = Math.floor(x / 64);
      const bz = Math.floor(z / 64);
      const block = sampler.generateBlock(bx, bz);
      const px = ORIGIN_OFFSET + Math.min(32, Math.max(0, Math.floor((x - bx * 64) / 2)));
      const pz = ORIGIN_OFFSET + Math.min(32, Math.max(0, Math.floor((z - bz * 64) / 2)));
      const i = pz * n + px;
      const family = block.radialNear![i * 2];
      if (Math.hypot(x + 30, z - 20) <= 8) out.mown++;
      if (!family) continue;
      if (block.excluded[i]) {
        out.excluded++;
        continue;
      }
      const child = group.families.get(family)!.choose(rc)!;
      if (circles.some((c) => Math.hypot(gx - c.x, gz - c.z) <= c.r)) {
        out.circled++;
        continue;
      }
      const height = sampler.heightAt(x, z);
      const under = t.waterAt(gx, gz) > height;
      if (under) out.wet++;
      if (under && !MEANT_FOR_WATER.test(child.shader)) {
        out.water++;
        continue;
      }
      const w = child.minWidth + rw * (child.maxWidth - child.minWidth);
      const h = child.minHeight + (child.maintainAspect ? rw : rh) * (child.maxHeight - child.minHeight);
      const hs = block.heights;
      const dx = (hs[i + 1] - hs[i - 1]) / 4;
      const dz = (hs[i + n] - hs[i - n]) / 4;
      const len = Math.hypot(dx, 1, dz);
      // The terrain's normal (-dx, 1, -dz) / len, its x turned into the game's frame.
      const c = block.colors;
      out.want.push([f4(gx), f4(gz), shaders.get(shaderKey(child.shader))!.layer, f4(w), f4(h), f4(ry * Math.PI * 2), child.createPlus ? 1 : 0, f4(height), f4(dx / len), f4(1 / len), f4(-dz / len), f4(c[i * 3] / 255), f4(c[i * 3 + 1] / 255), f4(c[i * 3 + 2] / 255)].join(','));
    }
  }
  return out;
}

/** What placing wrote, in the same words. */
function placedList(b: ReturnType<typeof tuftBuffers>): string[] {
  const got: string[] = [];
  for (let i = 0; i < b.count; i++) {
    const a = i * 4;
    got.push([b.tuft[a].toFixed(4), b.tuft[a + 2].toFixed(4), b.size[a + 2], b.size[a].toFixed(4), b.size[a + 1].toFixed(4), b.tuft[a + 3].toFixed(4), b.size[a + 3] & TUFT_PLUS ? 1 : 0, b.tuft[a + 1].toFixed(4), b.normal[i * 3].toFixed(4), b.normal[i * 3 + 1].toFixed(4), b.normal[i * 3 + 2].toFixed(4), b.tint[a].toFixed(4), b.tint[a + 1].toFixed(4), b.tint[a + 2].toFixed(4)].join(','));
  }
  return got;
}
const sameLists = (a: string[], b: string[]): boolean => {
  if (!a.length || a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
};

const circles: FloraCircle[] = [{ x: 20, z: 40, r: 6 }];
{
  // The chunk at the game's (0, 0) bucket on a world centred at nought: game x is minus the terrain's.
  const o = groundChunkOrigin(0, 0, swg.groundShift, 64);
  ok(swg.prepareArea(o.x - 4, o.z - 4, 72, true), 'its blocks generated and cached (behind a loading screen in the game)');
  const out = tuftBuffers(candidateCapacity(near, 64));
  const stats = placeStats();
  const n = placeGrass(swg, world, near, o.x, o.z, 64, circles, GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, SWAY_DEFAULTS, out, stats);
  const w = fromScratch(swg, o, 0.42, circles);
  const got = placedList(out);
  ok(n === out.count && n > 1000, `the chunk holds ${n} tufts`);
  ok(sameLists(w.want, got), `every tuft is the one worked out from scratch -- its place, its child's layer, its size, its yaw, its crossed quad, the ground's height at its foot, the ground's normal in the game's frame and the colour map's tint -- and no other (${got.length} placed, ${w.want.length} worked out)`);
  ok(w.mown > 20 && w.excluded > 10 && w.circled > 10 && w.water > 5, `the remove-all disc (${w.mown} candidates under it), the generator's exclusion (${w.excluded}), a circle kept off the ground (${w.circled}) and the drawn water (${w.water}) each take theirs`);
  ok(stats.water === w.water && stats.circles === w.circled && stats.excluded === w.excluded && stats.notCached === 0 && stats.noPicture === 0, 'and the placing counts each as worked out');
  ok(w.wet > w.water, `a child meant for water stands under it (${w.wet - w.water} of the ${w.wet} under the lake kept)`);
  // The terrain is not level, nor the normal straight up, nor the tint one colour: so a height, a normal or a tint
  // read from the wrong place, or not turned into the game's frame, cannot agree by accident.
  let lo = Infinity;
  let hi = -Infinity;
  let leanX = 0;
  let leanBoth = 0;
  const tints = new Set<string>();
  for (let i = 0; i < out.count; i++) {
    lo = Math.min(lo, out.tuft[i * 4 + 1]);
    hi = Math.max(hi, out.tuft[i * 4 + 1]);
    if (Math.abs(out.normal[i * 3]) > 0.05) leanX++;
    if (out.normal[i * 3] > 0.05 && out.normal[i * 3 + 2] > 0.05) leanBoth++;
    tints.add(`${out.tint[i * 4].toFixed(3)},${out.tint[i * 4 + 1].toFixed(3)}`);
  }
  ok(hi - lo > 1.5 && leanX > 100 && leanBoth > 10 && tints.size > 20, `on ground that is not level (bases ${lo.toFixed(2)} to ${hi.toFixed(2)} m), leans (${leanX} normals off the vertical in x, ${leanBoth} toward +x and +z at once) and is not one colour (${tints.size} tints)`);
  let flagged = 0;
  let law = 0;
  for (let i = 0; i < out.count; i++) {
    if (out.sway[i * 4] > 0) flagged++;
    else if (out.sway[i * 4] === -1) law++;
  }
  ok(flagged > 0 && law > 0 && flagged + law === out.count, `a child the file flags sways by its own displacement (${flagged}), the rest by the trees' law (${law})`);
}
{
  // A near tiling with no border of its own (Dantooine's, Endor's, Rori's, Yavin 4's): the floor of ours, three
  // tenths of the tile, stands in, so the tufts are not a lattice.
  const bare = await terrainOf(0);
  ok(bare.template.flora.radial.tileBorder === 0, 'a second terrain says its near tiling has no border');
  const o = groundChunkOrigin(0, 0, bare.groundShift, 64);
  bare.prepareArea(o.x - 4, o.z - 4, 72, true);
  const out = tuftBuffers(candidateCapacity(bare.template.flora.radial, 64));
  placeGrass(bare, worldOf(bare), bare.template.flora.radial, o.x, o.z, 64, circles, GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, SWAY_DEFAULTS, out, placeStats());
  const w = fromScratch(bare, o, GRASS_DEFAULTS.jitterMin * 1, circles);
  ok(GRASS_DEFAULTS.jitterMin === 0.3 && sameLists(w.want, placedList(out)), `there every tuft stands where a wander of ${GRASS_DEFAULTS.jitterMin} of the tile puts it (${out.count} placed, ${w.want.length} worked out)`);
  let off = 0;
  for (let i = 0; i < out.count; i++) {
    const fx = out.tuft[i * 4] - Math.floor(out.tuft[i * 4]);
    if (Math.abs(fx - 0.5) > 0.1) off++;
  }
  ok(off > out.count * 0.5, `and most stand off their tile's middle (${off} of ${out.count} more than a tenth of a metre)`);
  bare.dispose();
}

// ---------------------------------------------------------------- 2. a far tile, from scratch

const FAR_TILE = 512;
const FAR_RES = 32;
const STEP = FAR_TILE / FAR_RES;
const FAR_N = FAR_RES + 3;
const DROP = 2.5;
const farOrigin = groundChunkOrigin(0, 0, swg.groundShift, FAR_TILE);
const farGrid = swg.farGrid(farOrigin.x, farOrigin.z, FAR_TILE, FAR_RES, true)!;
const samples: FarSamples = { heights: farGrid.heights, colors: farGrid.colors, radialFar: farGrid.radialFar, n: FAR_N, step: STEP, gx0: farOrigin.x - STEP, gz0: farOrigin.z - STEP };
const farCircle: FloraCircle = { x: 150, z: 100, r: 90 };
{
  // The coarse grid generated here in the terrain's own frame: its first column at the terrain x of the tile's
  // far edge plus a step, its first row a step before the tile.
  const sx = -(farOrigin.x + FAR_TILE + STEP);
  const sz = farOrigin.z - STEP;
  const raw = swg.sampler.generate(sx, sz, FAR_N, STEP);
  // The far grid the game draws from is that grid mirrored into the game's frame: a sample at game x is the raw
  // sample at terrain x = -game x.
  let copied = 0;
  let mismatched = 0;
  for (let k = 0; k < FAR_N; k++) {
    for (let i = 0; i < FAR_N; i++) {
      const tx = -(samples.gx0 + i * STEP);
      const c = Math.round((tx - sx) / STEP);
      const s = k * FAR_N + i;
      const r = k * FAR_N + c;
      if (farGrid.radialFar[s * 2] === raw.radialFar[r * 2] && farGrid.radialFar[s * 2 + 1] === raw.radialFar[r * 2 + 1] && farGrid.heights[s] === raw.heights[r]) copied++;
      else mismatched++;
    }
  }
  ok(mismatched === 0 && copied === FAR_N * FAR_N, `the far grid's own far map and heights are the grid generated at each sample's own terrain place (${copied} samples)`);

  const out = tuftBuffers(candidateCapacity(far, FAR_TILE));
  const stats = placeStats();
  const n = placeFarCards(swg, world, far, farOrigin.x, farOrigin.z, FAR_TILE, samples, DROP, () => [farCircle], FAR_CARD_DEFAULTS, out, stats);
  const want: string[] = [];
  let wet = 0;
  let circled = 0;
  for (let tz = -2; tz <= 18; tz++) {
    for (let tx = -18; tx <= 2; tx++) {
      const r = new FastRandomGenerator(hashTuple(tx * 32, tz * 32));
      const x = (tx + 0.5) * 32 + (r.randomFloat() * 2 - 1) * 8;
      const z = (tz + 0.5) * 32 + (r.randomFloat() * 2 - 1) * 8;
      const rc = r.randomFloat();
      const gx = -x;
      const gz = z;
      if (gx < farOrigin.x || gx >= farOrigin.x + FAR_TILE || gz < farOrigin.z || gz >= farOrigin.z + FAR_TILE) continue;
      // In the raw grid's own frame: the nearest sample, and the bilinear height.
      const fx = (x - sx) / STEP;
      const fz = (z - sz) / STEP;
      const c = Math.round(fx);
      const k = Math.round(fz);
      const s = k * FAR_N + c;
      const family = raw.radialFar[s * 2];
      if (!family) continue;
      const child = group.families.get(family)!.choose(rc)!;
      if (Math.hypot(gx - farCircle.x, gz - farCircle.z) <= farCircle.r) {
        circled++;
        continue;
      }
      const ia = Math.floor(fx);
      const ka = Math.floor(fz);
      const u = fx - ia;
      const v = fz - ka;
      const h = raw.heights;
      const ground = (h[ka * FAR_N + ia] * (1 - u) + h[ka * FAR_N + ia + 1] * u) * (1 - v) + (h[(ka + 1) * FAR_N + ia] * (1 - u) + h[(ka + 1) * FAR_N + ia + 1] * u) * v;
      if (swg.waterAt(gx, gz) > ground) {
        wet++;
        continue;
      }
      const cs = raw.colors;
      want.push([f4(gx), f4(gz), shaders.get(shaderKey(child.shader))!.layer, (ground - DROP).toFixed(2), f4(cs[s * 3] / 255), f4(cs[s * 3 + 1] / 255), f4(cs[s * 3 + 2] / 255)].join(','));
    }
  }
  const got: string[] = [];
  for (let i = 0; i < out.count; i++) got.push([out.tuft[i * 4].toFixed(4), out.tuft[i * 4 + 2].toFixed(4), out.size[i * 4 + 2], out.tuft[i * 4 + 1].toFixed(2), out.tint[i * 4].toFixed(4), out.tint[i * 4 + 1].toFixed(4), out.tint[i * 4 + 2].toFixed(4)].join(','));
  ok(n > 50 && sameLists(want, got), `a far tile's cards are every candidate whose nearest coarse sample holds a far family, each standing on the samples' own bilinear height less the far ground's drop and tinted by the sample's colour (${n} placed, ${want.length} worked out)`);
  ok(wet > 3 && circled > 3 && stats.water === wet && stats.circles === circled, `a far lake (${wet} candidates under it) and a circle kept off the ground (${circled}) each take theirs, and are counted so`);
  let hills = 0;
  let allFar = true;
  for (let i = 0; i < out.count; i++) {
    if (!(out.size[i * 4 + 3] & TUFT_FAR) || out.size[i * 4 + 2] !== 3 || out.sway[i * 4] !== -2 || out.normal[i * 3 + 1] !== 1) allFar = false;
    if (out.tuft[i * 4 + 1] > -DROP + 0.5) hills++;
  }
  ok(allFar && hills > n * 0.5, `each is marked far, wears its picture's layer, stands straight up and does not sway, on hills (${hills} stand more than half a metre over the drop)`);
}

// ---------------------------------------------------------------- 3. a far card stands only where no near chunk does

{
  const material = grassMaterial();
  const file = readRadialFile({ radialFormat: 1, size: 256, layers: 4, shaders: Object.fromEntries(shaders) })!;
  const setup: GrassSetup = { src: swg, world, file, near, far, shift: swg.groundShift, reference: null };
  const loaded = new Set<string>();
  // A bucket whose chunk stands with its trees hidden by a short Tree distance (wave 8): its cards stand in, lifted.
  const thinned = new Set<string>();
  const host: GrassHost = { circlesFor: () => {}, adopt: () => {}, chunkTrees: (cx, cz) => (thinned.has(`${cx},${cz}`) ? CHUNK_TREES.hidden : loaded.has(`${cx},${cz}`) ? CHUNK_TREES.shown : CHUNK_TREES.none), cascadeOf: () => 0 };
  // Two 64 m buckets of the tile that hold cards: one with its chunk standing as the tile is built, one without.
  const probe = tuftBuffers(candidateCapacity(far, FAR_TILE));
  placeFarCards(swg, world, far, farOrigin.x, farOrigin.z, FAR_TILE, samples, DROP, () => [], FAR_CARD_DEFAULTS, probe, placeStats());
  const counts = new Map<string, number>();
  for (let i = 0; i < probe.count; i++) {
    const key = `${Math.floor(probe.tuft[i * 4] / 64)},${Math.floor(probe.tuft[i * 4 + 2] / 64)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets = [...counts.keys()];
  const standing = buckets[0];
  // The fullest of the buckets between the two.
  const thin = buckets.slice(1, -1).reduce((a, b) => ((counts.get(b) ?? 0) > (counts.get(a) ?? 0) ? b : a), buckets[1]);
  const coming = buckets[buckets.length - 1];
  loaded.add(standing);
  thinned.add(thin);
  const depth = grassDepthMaterial();
  const cards = new FarCards(material, host, new THREE.Group(), FAR_TILE, DROP, depth);
  cards.setWorld(setup);
  cards.tileMade(0, 0, farOrigin.x, farOrigin.z, samples);
  cards.update(new THREE.Vector3(farOrigin.x + 256, 5, farOrigin.z + 256), 1);
  const mesh = cards.meshes[0];
  ok(mesh !== undefined && buckets.length > 4 && standing !== coming && thin !== coming, `the tile's cards are built (${buckets.length} buckets hold cards)`);
  const tuft = mesh.geometry.getAttribute('aSwgTuft') as THREE.InstancedBufferAttribute;
  const size = mesh.geometry.getAttribute('aSwgSize') as THREE.InstancedBufferAttribute;
  // As built, by the far cards' own build: lifted exactly in the bucket whose chunk stands with its trees hidden.
  let lifted = 0;
  let liftedElsewhere = 0;
  for (let i = 0; i < size.count; i++) {
    const key = `${Math.floor((tuft.array as Float32Array)[i * 4] / 64)},${Math.floor((tuft.array as Float32Array)[i * 4 + 2] / 64)}`;
    const f = (size.array as Float32Array)[i * 4 + 3];
    if (f & TUFT_LIFT) {
      if (key === thin && !(f & TUFT_HIDDEN)) lifted++;
      else liftedElsewhere++;
    }
  }
  ok(lifted === counts.get(thin) && liftedElsewhere === 0, `built over a chunk whose trees a short Tree distance hides, its cards there are shown and lifted onto the coarse height, and no other card is (${lifted} lifted)`);
  thinned.delete(thin);
  cards.chunksChanged([Number(thin.split(',')[0])], [Number(thin.split(',')[1])], [CHUNK_TREES.none], 1);
  ok(mesh.customDepthMaterial === depth && !mesh.castShadow, 'the tile\'s mesh hangs the casting depth material and, the far cards not casting, casts nothing');
  GRASS_SHADOW_TUNE.farCast = true;
  cards.applyCast();
  const castOn = mesh.castShadow && cards.casting === 1;
  Object.assign(GRASS_SHADOW_TUNE, GRASS_SHADOW_DEFAULTS);
  cards.applyCast();
  ok(castOn && !mesh.castShadow, 'the far cards switched to cast, a tile already standing casts by `applyCast` alone, and stops again when they are switched back');
  /** Each card hidden exactly where its bucket's chunk stands now: the cards wrong, and the cards hidden. */
  const check = (): { wrong: number; hidden: number } => {
    let wrong = 0;
    let hidden = 0;
    for (let i = 0; i < size.count; i++) {
      const key = `${Math.floor((tuft.array as Float32Array)[i * 4] / 64)},${Math.floor((tuft.array as Float32Array)[i * 4 + 2] / 64)}`;
      const isHidden = ((size.array as Float32Array)[i * 4 + 3] & TUFT_HIDDEN) !== 0;
      if (isHidden) hidden++;
      if (isHidden !== loaded.has(key)) wrong++;
    }
    return { wrong, hidden };
  };
  const built = check();
  ok(built.wrong === 0 && built.hidden === counts.get(standing), `built over a near chunk that stands, its cards there are hidden and no other (${built.hidden} hidden)`);
  const was = size.version;
  const [sx0, sz0] = standing.split(',').map(Number);
  const [cx0, cz0] = coming.split(',').map(Number);
  loaded.delete(standing);
  loaded.add(coming);
  cards.chunksChanged([sx0, cx0], [sz0, cz0], [0, 1], 2);
  const moved = check();
  ok(moved.wrong === 0 && moved.hidden === counts.get(coming) && size.version > was, `a chunk going shows its cards again and one coming hides its own, and the attribute is marked for upload (${moved.hidden} hidden now)`);
  const still = size.version;
  cards.chunksChanged([cx0], [cz0], [1], 1);
  ok(check().wrong === 0 && size.version === still, 'a chunk said to come where it already stands changes nothing and uploads nothing');
}

// ---------------------------------------------------------------- 4. nothing generated on this thread

{
  const o = groundChunkOrigin(-1, 0, swg.groundShift, 64);
  swg.prepareArea(o.x - 4, o.z - 4, 72, true);
  const s = swg.sampler as unknown as { generateBlock: (bx: number, bz: number) => unknown; generate: (...a: number[]) => unknown };
  let generated = 0;
  let heights = 0;
  const keepBlock = s.generateBlock;
  const keepGenerate = s.generate;
  const keepHeight = swg.heightAt;
  s.generateBlock = function (bx: number, bz: number) {
    if (!this.hasBlock(bx, bz)) generated++;
    return keepBlock.call(this, bx, bz);
  } as typeof s.generateBlock & ThisType<{ hasBlock(a: number, b: number): boolean }>;
  s.generate = function (...a: number[]) {
    generated++;
    return keepGenerate.apply(this, a);
  };
  swg.heightAt = (gx: number, gz: number) => {
    heights++;
    return keepHeight.call(swg, gx, gz);
  };
  try {
    const out = tuftBuffers(candidateCapacity(near, 64));
    const n = placeGrass(swg, world, near, o.x, o.z, 64, [], GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, SWAY_DEFAULTS, out, placeStats());
    ok(n > 0 && generated === 0 && heights === 0, `a chunk whose blocks are cached is placed with no block generated and no height asked for (${n} tufts; ${generated} generated, ${heights} heights)`);
    swg.sampler.invalidateAll();
    const stats = placeStats();
    out.count = 0;
    const none = placeGrass(swg, world, near, o.x, o.z, 64, [], GRASS_DEFAULTS, GRASS_SWAY_DEFAULTS, SWAY_DEFAULTS, out, stats);
    ok(none === 0 && stats.notCached === stats.candidates && stats.candidates > 0 && generated === 0, `and one whose blocks are not cached places nothing and generates nothing (${stats.notCached} candidates passed over)`);
  } finally {
    s.generateBlock = keepBlock;
    s.generate = keepGenerate;
    swg.heightAt = keepHeight;
  }
}

// ---------------------------------------------------------------- 5. the window

{
  const material = grassMaterial();
  const roots = new Map<string, THREE.Group>();
  let adopted = 0;
  const host: GrassHost = { circlesFor: (cx, cz, out) => { if (cx === 0 && cz === 0) for (const c of circles) out.push(c); }, adopt: () => void adopted++, chunkTrees: (cx, cz) => (roots.has(`${cx},${cz}`) ? 1 : 0), cascadeOf: () => 0 };
  const file = readRadialFile({ radialFormat: 1, size: 256, layers: 4, shaders: Object.fromEntries(shaders) })!;
  const setup: GrassSetup = { src: swg, world, file, near, far, shift: swg.groundShift, reference: null };
  const field = new GrassField(material, host);
  field.setWorld(setup);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const o = groundChunkOrigin(cx, cz, swg.groundShift, 64);
      swg.prepareArea(o.x - 4, o.z - 4, 72, true);
      const g = new THREE.Group();
      roots.set(`${cx},${cz}`, g);
      field.chunkMade(cx, cz, g);
    }
  }
  const meshes = () => [...roots.values()].reduce((n, g) => n + g.children.length, 0);
  const eye = new THREE.Vector3(10, 1.7, 10);
  field.update(eye, 1);
  ok(meshes() === 1 && roots.get('0,0')!.children.length === 1, 'one chunk a frame, the eye\'s own first');
  for (let i = 0; i < 12; i++) field.update(eye, 1);
  ok(meshes() === 9, `then the window of nine round it (${meshes()} chunks with grass)`);
  ok(adopted === 9, 'each mesh handed to the world before it is drawn');
  const mesh = roots.get('0,0')!.children[0] as THREE.Mesh;
  ok(mesh.material === material && !mesh.castShadow && !mesh.receiveShadow && mesh.layers.mask === 1, 'drawn with the one material, casting and taking no shadow, on layer 0 alone');
  // A circle added: the chunk under it is built again, and only it.
  const before = roots.get('1,1')!.children[0];
  const under = roots.get('0,0')!.children[0];
  circles.push({ x: 10, z: 10, r: 4 });
  field.circleChanged(10, 10, 4);
  field.update(eye, 9);
  ok(roots.get('0,0')!.children[0] !== under && roots.get('1,1')!.children[0] === before, 'a circle kept off the ground builds the chunk under it again and no other');
  eye.set(70, 1.7, 10);
  for (let i = 0; i < 12; i++) field.update(eye, 1);
  ok(roots.get('-1,0')!.children.length === 0 && roots.get('2,0')!.children.length === 1 && meshes() === 9, 'the window follows the eye: the column it left is taken down, the one it reached built');
  field.chunkGone(2, 0);
  ok(roots.get('2,0')!.children.length === 0, 'a chunk going takes its grass with it');

  // A frame that crosses no chunk makes nothing.
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    let scavenges = 0;
    const watch = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
    });
    watch.observe({ entryTypes: ['gc'] });
    const farCards = new FarCards(material, host, new THREE.Group(), 512, 2.5);
    farCards.setWorld(setup);
    const frames = 200_000;
    const step = (i: number) => {
      eye.x = 70 + (i % 50) * 0.1;
      field.update(eye, 1);
      farCards.update(eye, 1);
    };
    for (let i = 0; i < 20_000; i++) step(i);
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      gc();
      await new Promise((r) => setImmediate(r));
      scavenges = 0;
      const was = young();
      for (let i = 0; i < frames; i++) step(i);
      const made = young() - was;
      await new Promise((r) => setImmediate(r));
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made < 64 * 1024) break;
    }
    watch.disconnect();
    ok(best.scavenges === 0 && best.made < 64 * 1024, `${frames} frames that cross no chunk make nothing (${Math.max(0, best.made)} bytes, ${best.scavenges} collections of the young generation)`);
  } else note('run with node --expose-gc to measure that a frame crossing no chunk makes nothing');
  ok(GRASS_TUNE.window === 3, 'the window is three chunks across by default');
}

// ---------------------------------------------------------------- 5b. what a chunk built casts with, and the window's reach

{
  const material = grassMaterial();
  const depth = grassDepthMaterial();
  const roots = new Map<string, THREE.Group>();
  const cams = [new THREE.OrthographicCamera(), new THREE.OrthographicCamera(), new THREE.OrthographicCamera()];
  const host: GrassHost = { circlesFor: () => {}, adopt: () => {}, chunkTrees: () => CHUNK_TREES.none, cascadeOf: (c) => Math.max(0, cams.indexOf(c as THREE.OrthographicCamera)) };
  const file = readRadialFile({ radialFormat: 1, size: 256, layers: 4, shaders: Object.fromEntries(shaders) })!;
  const setup: GrassSetup = { src: swg, world, file, near, far, shift: swg.groundShift, reference: null };
  const field = new GrassField(material, host, depth);
  field.setWorld(setup);
  // The same 5 by 5 chunks the window's own check prepared its ground for.
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const g = new THREE.Group();
      roots.set(`${cx},${cz}`, g);
      field.chunkMade(cx, cz, g);
    }
  }
  const built = () => (field as unknown as { chunks: { built: boolean }[] }).chunks.filter((c) => c.built).length;
  const eye = new THREE.Vector3(10, 1.7, 10);
  for (let i = 0; i < 12; i++) field.update(eye, 1);
  ok(built() === 9 && GRASS_TUNE.window === 3, `the window of nine round the eye at the world's own reach (${built()} built)`);
  const mesh = roots.get('0,0')!.children[0] as THREE.Mesh;
  ok(mesh.customDepthMaterial === depth && !mesh.castShadow, 'a chunk built through the field hangs its casting depth material, and casts nothing until the field finds it in reach of a casting grass');
  // Its shadow hooks, as three's shadow pass calls them: the probe third, the cascade's own camera fourth.
  const g = mesh.geometry as THREE.InstancedBufferGeometry;
  const all = g.instanceCount;
  const probe = new THREE.PerspectiveCamera();
  const drawnIn = (n: number): number[] => {
    GRASS_CAST.cascades = n;
    const out: number[] = [];
    for (const cam of cams) {
      mesh.onBeforeShadow(null as never, null as never, probe, cam, g, depth, null as never);
      out.push(g.instanceCount);
      mesh.onAfterShadow(null as never, null as never, probe, cam, g, depth, null as never);
    }
    return out;
  };
  const one = drawnIn(1);
  const two = drawnIn(2);
  GRASS_CAST.cascades = 1;
  ok(all > 0 && JSON.stringify(one) === JSON.stringify([all, 0, 0]) && JSON.stringify(two) === JSON.stringify([all, all, 0]) && g.instanceCount === all, `and the shadow hooks the field hangs as it builds: a cascade past the count in force draws none of its ${all} tufts, for that one draw (${one.join(', ')}; ${two.join(', ')})`);
  // The window follows the page's grass distance.
  setGrassTune({ reachScale: 3 });
  for (let i = 0; i < 30; i++) field.update(eye, 1);
  const wide = built();
  const wideWindow = GRASS_TUNE.window;
  setGrassTune({ reachScale: 1 });
  field.update(eye, 1);
  ok(wideWindow === 5 && wide === 25 && GRASS_TUNE.window === 3 && built() === 9, `the grass distance three times the world's own widens the window to five chunks and builds them (${wide}), and put back it lets the outer ring go (${built()})`);
}

// ---------------------------------------------------------------- 6. the converted worlds

/**
 * The share of 2 m poles holding a near family over random 64 m blocks, worked out by the study's own measuring
 * script (its own copy of the affector, counting the poles inside each block's pad) over 2,000 blocks a world,
 * against the generator as it now stands (roads clearing the flora). The study's first figures were over 120
 * blocks (Lok's 49% among them, which 2,000 blocks put at 53%): what moved is the study's own sample.
 */
const SHARE: Record<string, number> = { tatooine: 0.2483, naboo: 0.6831, corellia: 0.7441, dantooine: 0.7034, lok: 0.5345, endor: 0.4246, dathomir: 0.4766, yavin4: 0.7713, talus: 0.7324, rori: 0.4387 };
const STUDY_BLOCKS = 2000;
const worlds = groundWorlds().filter((w) => w in SHARE && existsSync(join(PACKS, w, 'terrain', 'radial.json')));
if (!worlds.length) note(`no converted world with radial pictures under ${PACKS}: only the terrain built in memory was checked`);
for (const name of worlds) {
  const dir = join(PACKS, name);
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { center: { x: number; z: number } };
  const t = await SwgTerrain.create(new Uint8Array(readFileSync(join(dir, 'terrain.trn'))).buffer as ArrayBuffer, [], layout.center.x, layout.center.z, async (f) => (existsSync(join(dir, f)) ? new Uint8Array(readFileSync(join(dir, f))).buffer as ArrayBuffer : null));
  const file = readRadialFile(JSON.parse(readFileSync(join(dir, 'terrain', 'radial.json'), 'utf8')))!;
  const k = new Map<RadialChild, string>();
  for (const f of t.template.generator.radialGroup.families.values()) for (const c of f.children) k.set(c, shaderKey(c.shader));
  const w: GrassWorld = { group: t.template.generator.radialGroup, shaders: file.shaders, keyOf: (c) => k.get(c)! };
  const tiling = t.template.flora.radial;
  const half = t.template.mapWidthInMeters / 2;
  const rnd = new FastRandomGenerator(4242);
  const stats = placeStats();
  const out = tuftBuffers(candidateCapacity(tiling, 64));
  const chunks = 200;
  let tufts = 0;
  let badBase = 0;
  let worstBase = 0;
  const shares: number[] = [];
  let poleAll = 0;
  let poleHeld = 0;
  const s = t.sampler;
  const n = s.numberOfPoles;
  for (let i = 0; i < chunks; i++) {
    // Drawn over the terrain's own square less 600 m a side, as the study drew its blocks, whatever the layout's centre.
    const gx = t.toGameX((rnd.randomFloat() * 2 - 1) * (half - 600));
    const gz = t.toGameZ((rnd.randomFloat() * 2 - 1) * (half - 600));
    const o = groundChunkOrigin(Math.floor((gx - t.groundShift.x) / 64), Math.floor((gz - t.groundShift.z) / 64), t.groundShift, 64);
    t.prepareArea(o.x - 4, o.z - 4, 72, true);
    out.count = 0;
    const was = { c: stats.candidates, f: stats.noFamily + stats.notCached };
    tufts += placeGrass(t, w, tiling, o.x, o.z, 64, [], { ...GRASS_DEFAULTS, water: 'keep' }, GRASS_SWAY_DEFAULTS, SWAY_DEFAULTS, out, stats);
    const cand = stats.candidates - was.c;
    if (cand) shares.push((cand - (stats.noFamily + stats.notCached - was.f)) / cand);
    // Every tuft at the ground's own height at its foot, as the ground's own lookup answers it. The foot is asked of
    // at its place as the buffers keep it, in single precision, which is up to a millimetre off seven kilometres
    // out: a centimetre allows for that on any slope a planet has, and nothing read from the wrong spot gets in it.
    for (let j = 0; j < out.count; j++) {
      const h = t.heightIfCached(out.tuft[j * 4], out.tuft[j * 4 + 2], 512, 32);
      const d = h === null ? Infinity : Math.abs(h - out.tuft[j * 4 + 1]);
      worstBase = Math.max(worstBase, d);
      if (d > 0.01) badBase++;
    }
    // The poles of the same chunk's ground (each 2 m cell whose middle lies in the chunk's terrain square), read
    // out of the cached blocks here: what the candidates sample.
    const xa = t.toSwgX(o.x + 64);
    const xb = t.toSwgX(o.x);
    const za = t.toSwgZ(o.z);
    const zb = t.toSwgZ(o.z + 64);
    for (let z = Math.floor(za / 2) * 2; z < zb; z += 2) {
      if (z + 1 < za || z + 1 >= zb) continue;
      for (let x = Math.floor(xa / 2) * 2; x < xb; x += 2) {
        if (x + 1 <= xa || x + 1 > xb) continue;
        const bx = Math.floor(x / 64);
        const bz = Math.floor(z / 64);
        const b = s.generateBlock(bx, bz);
        const p = (ORIGIN_OFFSET + Math.floor((z - bz * 64) / 2)) * n + ORIGIN_OFFSET + Math.floor((x - bx * 64) / 2);
        poleAll++;
        if (b.radialNear![p * 2]) poleHeld++;
      }
    }
    t.sampler.invalidateAll();
  }
  const share = (stats.candidates - stats.noFamily - stats.notCached) / Math.max(1, stats.candidates);
  const poles = poleHeld / Math.max(1, poleAll);
  ok(badBase === 0 && stats.noPicture === 0 && stats.notCached === 0, `${name}: every one of ${tufts} tufts over ${chunks} chunks drawn at random stands at the ground's own height at its foot (worst ${worstBase.toExponential(1)} m), every one with its picture`);
  ok(Math.abs(share - poles) < 0.02, `${name}: ${(share * 100).toFixed(1)}% of the candidates find a near family, and ${(poles * 100).toFixed(1)}% of the same chunks' poles hold one`);
  // The two samples' spread: ours chunk by chunk, taken for the study's blocks too (the same world, the same size).
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const sd = Math.sqrt(shares.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, shares.length - 1));
  const tol = 3 * sd * Math.sqrt(1 / shares.length + 1 / STUDY_BLOCKS);
  ok(Math.abs(share - SHARE[name]) < tol, `${name}: and the study's share of poles over ${STUDY_BLOCKS} blocks, ${(SHARE[name] * 100).toFixed(1)}%, within three of the two samples' standard errors (${(Math.abs(share - SHARE[name]) * 100).toFixed(1)} points apart, ${(tol * 100).toFixed(1)} allowed)`);
  t.dispose();
}

console.log(`\n${passed} passed`);
