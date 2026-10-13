// The ground's tile rules (`src/world/groundTiles.ts`, materials and ground pass, wave 5): where a chunk's
// ground stands, and what each 4 m tile is made of. Every check is of what the rules answer:
//
//   1. the shift: from any centre, every vertex a chunk's ground puts 2 m apart from its origin falls on a pole
//      of the terrain's own lattice, and the bucket a point is in is the chunk whose ground covers it; and the
//      same over every converted world's own layout centre (SWG3JS_PACKS, else assets-private): nineteen, of
//      which the twelve odd-centred ones are the ones the shift moves
//   2. the masks as the converter wrote them, read off the packs' own PNGs: every corner pattern, turned onto
//      its corners, is 255 at the covered corners and nought at the rest (at most 22 anywhere along an edge it
//      does not cover), and the two opposite pairs come out of two quarters
//   3. a tile's layers worked out by hand: one family is one layer and no overlay; families come bottom first
//      by rank, ties by the corners' order; each layer's choice is the first corner's in `childCorner` order
//   4. Tatooine's own ground over the research's 64 blocks: the share of tiles holding one family (78.5%), two,
//      three and four, as the research counted them
//
// Run: node tools/swg/tests/groundTiles.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cornerOrder, groundChunkAt, groundChunkOrigin, groundShift, maskCode, maskKind, maskTurn, NE, NW, SE, SW, tileLayers, turnTile, type GroundTiler } from '../../../src/world/groundTiles.ts';
import { maskWeight, type MaskSample } from '../../../src/world/groundMath.ts';
import { decodePng } from '../png.mjs';
import { loadWorld, PACKS, sampleBlocks } from './terrainHarness.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string) => console.log(`note ${s}`);
const mod = (v: number, m: number) => ((v % m) + m) % m;

// ---------------------------------------------------------------- 1. the shift

/** Every vertex of a chunk's 33 by 33 grid on a pole, and the bucket of every point its ground covers its own. */
function shiftHolds(cx: number, cz: number): { onPoles: boolean; bucketed: boolean; shift: { x: number; z: number } } {
  const s = groundShift(cx, cz);
  let onPoles = true;
  let bucketed = true;
  for (const [kx, kz] of [[0, 0], [-3, 2], [7, -5]]) {
    const o = groundChunkOrigin(kx, kz, s);
    for (let i = 0; i <= 32; i++) {
      // game x = centre x - terrain x, game z = terrain z - centre z
      if (mod(cx - (o.x + 2 * i), 2) !== 0 || mod(o.z + 2 * i + cz, 2) !== 0) onPoles = false;
    }
    for (let f = 0.01; f < 64; f += 1.37) if (groundChunkAt(o.x + f, s.x) !== kx || groundChunkAt(o.z + f, s.z) !== kz) bucketed = false;
    if (o.x < kx * 64 || o.x >= kx * 64 + 2 || o.z < kz * 64 || o.z >= kz * 64 + 2) bucketed = false;
  }
  return { onPoles, bucketed, shift: s };
}

{
  let every = true;
  let buckets = true;
  for (let cx = -9; cx <= 9; cx++) {
    for (let cz = -9; cz <= 9; cz++) {
      const r = shiftHolds(cx, cz);
      every &&= r.onPoles;
      buckets &&= r.bucketed;
    }
  }
  ok(every, 'from any centre, odd or even, either sign, every vertex a chunk puts 2 m apart from its origin falls on one of the terrain\'s poles');
  ok(buckets, 'and its origin stays within 2 m of its bucket\'s corner, so every point its ground covers is that bucket\'s');
  const unshifted = groundChunkOrigin(1, 1);
  ok(unshifted.x === 64 && unshifted.z === 64, 'with no shift a chunk starts at its bucket\'s corner, as every chunk did before');
}

/** Every converted world's layout centre, out of its layout file. */
function centres(): { name: string; x: number; z: number }[] {
  if (!existsSync(PACKS)) return [];
  const out: { name: string; x: number; z: number }[] = [];
  for (const name of readdirSync(PACKS).sort()) {
    if (!existsSync(join(PACKS, name, 'terrain.trn'))) continue;
    const file = join(PACKS, name, 'layout.json');
    if (!existsSync(file)) continue;
    const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(file, 'utf8').slice(0, 8000));
    if (m) out.push({ name, x: Number(m[1]), z: Number(m[2]) });
  }
  return out;
}

{
  const list = centres();
  if (!list.length) note(`no converted worlds under ${PACKS}: the nineteen centres are not checked here`);
  else {
    const failing = list.filter((c) => !shiftHolds(c.x, c.z).onPoles || !shiftHolds(c.x, c.z).bucketed).map((c) => c.name);
    ok(failing.length === 0, `over the ${list.length} converted worlds' own centres every chunk's vertices fall on poles${failing.length ? `: not ${failing.join(', ')}` : ''}`);
    const moved = list.filter((c) => {
      const s = groundShift(c.x, c.z);
      return s.x !== 0 || s.z !== 0;
    });
    // Before the shift a vertex stood a metre off a pole on exactly these.
    const offBefore = list.filter((c) => mod(c.x, 2) !== 0 || mod(c.z, 2) !== 0);
    ok(moved.map((c) => c.name).join() === offBefore.map((c) => c.name).join(), `the shift moves exactly the worlds whose centre is odd in an axis (${moved.length} of ${list.length}: ${moved.map((c) => c.name).join(', ') || 'none'})`);
    if (list.length === 19) ok(moved.length === 12, 'twelve of the nineteen, as the research found');
    else note(`${list.length} worlds converted here, not nineteen: the count of twelve is not held`);
  }
}

// ---------------------------------------------------------------- 2. the masks the converter wrote

/** The packs' own masks, from the first world that carries them. */
function packMasks(): { size: number; read: MaskSample; texel: (k: number, x: number, y: number) => number } | null {
  if (!existsSync(PACKS)) return null;
  for (const name of readdirSync(PACKS).sort()) {
    const dir = join(PACKS, name, 'terrain', 'blend');
    const files = ['quarter.png', 'half.png', 'threequarter.png'].map((f) => join(dir, f));
    if (!files.every(existsSync)) continue;
    const imgs = files.map((f) => decodePng(readFileSync(f)) as { width: number; height: number; rgba: Uint8Array });
    const size = imgs[0].width;
    const texel = (k: number, x: number, y: number) => imgs[k].rgba[(Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))) * 4];
    // Nearest texel, as the corner checks want: (0, 0) is the first texel and (1, 1) the last.
    const read: MaskSample = (k, u, v) => texel(k, Math.round(u * (size - 1)), Math.round(v * (size - 1))) / 255;
    return { size, read, texel };
  }
  return null;
}

{
  const m = packMasks();
  if (!m) note(`no pack under ${PACKS} carries terrain/blend: the masks are not read here (the converter's own test holds them to the archives)`);
  else {
    const places: [number, number, number][] = [
      [SW, 0, 0],
      [SE, 1, 0],
      [NW, 0, 1],
      [NE, 1, 1],
    ];
    let covered = 255;
    let uncovered = 0;
    let edgeMost = 0;
    for (let bits = 1; bits < 15; bits++) {
      const code = maskCode(bits);
      for (const [bit, s, t] of places) {
        const w = Math.round(maskWeight(code, s, t, m.read, false, true) * 255);
        if (bits & bit) covered = Math.min(covered, w);
        else uncovered = Math.max(uncovered, w);
      }
      // Along every tile edge whose two corners the family does not hold, the mask stays low the whole way.
      const edges: [number, number, number, number][] = [
        [SW, SE, 0, -1],
        [NW, NE, 1, -1],
        [SW, NW, -1, 0],
        [SE, NE, -1, 1],
      ];
      for (const [a, b, tFix, sFix] of edges) {
        if (bits & a || bits & b) continue;
        for (let k = 0; k <= 64; k++) {
          const f = k / 64;
          const s = sFix < 0 ? f : sFix;
          const t = tFix < 0 ? f : tFix;
          edgeMost = Math.max(edgeMost, Math.round(maskWeight(code, s, t, m.read, false, true) * 255));
        }
      }
    }
    ok(covered === 255 && uncovered === 0, `on the masks the converter wrote, every corner pattern turned onto its corners is 255 at each covered corner and ${uncovered} at each uncovered one`);
    ok(edgeMost <= 22, `and along every tile edge none of its corners covers, at most ${edgeMost} of 255 (the research's "about 22")`);
    ok(maskKind(maskCode(SW | NE)) === 3 && maskTurn(maskCode(SE | NW)) === 1, 'the opposite pairs are their own kind, made of two quarters a half turn apart');
  }
}

{
  // The turns, by hand: each corner of the tile lands on the image's own top-left at its turn.
  const p: [number, number] = [0, 0];
  ok(turnTile(0, 0, 0, p).join() === '0,0' && turnTile(1, 0, 1, p).join() === '0,0' && turnTile(1, 1, 2, p).join() === '0,0' && turnTile(0, 1, 3, p).join() === '0,0', 'each quarter turn puts SW, SE, NE and NW in turn on the image\'s covered corner');
  ok(maskTurn(maskCode(SW)) === 0 && maskTurn(maskCode(SE)) === 1 && maskTurn(maskCode(NE)) === 2 && maskTurn(maskCode(NW)) === 3, 'and the quarter on each corner is coded with that turn');
}

// ---------------------------------------------------------------- 3. a tile's layers by hand

{
  const ranks = new Map([
    [10, 2],
    [20, 0],
    [30, 1],
    [40, 3],
  ]);
  const tiler: GroundTiler = {
    rank: (f) => ranks.get(f) ?? 99,
    // A layer per family and choice, so the test can read which corner's choice was taken.
    layer: (f, choice) => f + choice,
    corners: [0, 1, 2, 3],
  };
  const layers = new Uint8Array(4);
  const codes = new Uint8Array(3);
  ok(tileLayers([10, 10, 10, 10], [1, 2, 3, 4], tiler, layers, codes) === 1 && [...layers].join() === '11,11,11,11' && [...codes].join() === '0,0,0', 'one family on all four corners is one layer, the first corner\'s choice, and no overlay');
  ok(tileLayers([10, 20, 10, 20], [1, 2, 3, 4], tiler, layers, codes) === 2 && layers[0] === 22 && layers[1] === 11 && codes[0] === maskCode(SW | NW) && codes[1] === 0, 'two families: the lower-ranked at the bottom, the other laid over it on the corners it holds (here the west side)');
  ok(tileLayers([10, 20, 30, 40], [5, 6, 7, 8], tiler, layers, codes) === 4 && [...layers].join() === '26,37,15,48' && [...codes].join() === [maskCode(NW), maskCode(SW), maskCode(NE)].join(), 'four families bottom first by rank, each with its own corner\'s mask and choice');
  ok(tileLayers([30, 10, 30, 30], [9, 1, 2, 3], tiler, layers, codes) === 2 && layers[0] === 39 && codes[0] === maskCode(SE), 'a family on three corners at the bottom takes the first of them\'s choice, the one on the fourth a quarter');
  const sw = { ...tiler, corners: cornerOrder(['ne', 'nw']) };
  tileLayers([10, 10, 10, 10], [1, 2, 3, 4], sw, layers, codes);
  ok(layers[0] === 14 && cornerOrder(['ne', 'nw']).join() === '3,2,0,1', '`childCorner` decides which corner\'s choice a layer takes, any corner it leaves out asked after in the client\'s own order');
  const flipped = { ...tiler, rank: (f: number) => -(ranks.get(f) ?? 99) };
  tileLayers([10, 20, 10, 20], [1, 2, 3, 4], flipped, layers, codes);
  ok(layers[0] === 11 && codes[0] === maskCode(SE | NE), '`order: \'last\'` turns the ranks round, the other family at the bottom');
  const equal = { ...tiler, rank: () => 0 };
  tileLayers([20, 10, 10, 20], [1, 2, 3, 4], equal, layers, codes);
  ok(layers[0] === 21 && codes[0] === maskCode(SE | NW), 'two families of equal rank keep the corners\' own order, so the result never hangs on a sort');
}

// ---------------------------------------------------------------- 4. Tatooine's own tiles

{
  const world = loadWorld('tatooine');
  if (!world) note(`no Tatooine under ${PACKS}: its tiles are not counted here`);
  else {
    const t = world.template;
    const s = world.sampler;
    const order = new Map([...t.generator.shaderGroup.families.keys()].map((id, i) => [id, i]));
    const tiler: GroundTiler = { rank: (f) => order.get(f) ?? 999, layer: () => 0, corners: [0, 1, 2, 3] };
    const n = s.numberOfPoles;
    const counts = [0, 0, 0, 0, 0];
    const shapes = { quarter: 0, half: 0, opposite: 0, threequarter: 0 };
    const layers = new Uint8Array(4);
    const codes = new Uint8Array(3);
    const fams = new Int32Array(4);
    const choices = new Uint8Array(4);
    for (const b of sampleBlocks(t, 64, 12345)) {
      const block = s.generateBlock(b.bx, b.bz);
      // The research's tiles: corners at even indices, a tile [x, x + 2] for even x from 2 to n - 5.
      for (let z = 2; z <= n - 5; z += 2) {
        for (let x = 2; x <= n - 5; x += 2) {
          fams[0] = block.shaders[z * n + x];
          fams[1] = block.shaders[z * n + x + 2];
          fams[2] = block.shaders[(z + 2) * n + x];
          fams[3] = block.shaders[(z + 2) * n + x + 2];
          const c = tileLayers(fams, choices, tiler, layers, codes);
          counts[c]++;
          for (let i = 0; i < c - 1; i++) {
            const k = maskKind(codes[i]);
            if (k === 0) shapes.quarter++;
            else if (k === 1) shapes.half++;
            else if (k === 2) shapes.threequarter++;
            else shapes.opposite++;
          }
        }
      }
    }
    const total = counts.reduce((a, v) => a + v, 0);
    const single = counts[1] / total;
    ok(total === 14400 && Math.abs(single - 0.785) < 0.01, `on Tatooine's own ground ${(single * 100).toFixed(1)}% of the research's ${total} tiles hold one family (78.5% measured there)`);
    note(`Tatooine tiles: one ${counts[1]}, two ${counts[2]}, three ${counts[3]}, four ${counts[4]}; overlays: quarter ${shapes.quarter}, half ${shapes.half}, opposite ${shapes.opposite}, three-quarter ${shapes.threequarter} (the research: two 2851, three 245, four 3; quarter 767, half 1999, diagonal 123, three-quarter 461)`);
    ok(Math.abs(counts[2] - 2851) / 2851 < 0.05 && counts[4] <= 20, 'and the two-, three- and four-family tiles fall where the research counted them');
  }
}

console.log(`\n${passed} checks passed`);
