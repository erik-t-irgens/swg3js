// A real-elevation world's map picture, made in the browser from its raster (Map-maker II's eighth wave, `src/world/demMap.ts`):
// a synthetic raster through the game's own `makeDemPatch`, its picture read back through the very frame every map places it
// by (`mapShareX`/`mapShareY` over `mapFromGameX`/`mapFromGameZ` about (0, 0), the frame `App.finishMadeMap` hands
// `setMadePicture`), puts a known peak's pixel where the frame puts the peak's point; a lake of ours on it is drawn in its own
// colour inside its outline and only where its surface stands over the ground (an island in it stays ground); a painted
// family's cells come out in that family's colour and the rest in the palette's (flat ground takes no shade); the slices are
// `sliceRows` rows each, `px / sliceRows` of them, no frame past `sliceMs` beyond the one row always made; Monument's
// committed raster makes its 1024 px picture the same way; and an edit landing asks for the picture again once the debounce
// has passed, never before.
//
// Run: node tools/swg/tests/demMap.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DemMapMaker, MAP_PICTURE_TUNE, demMapSourceOf, remakeDue, tuneMapPicture, type DemMapSource, type DemMapWorld } from '../../../src/world/demMap.ts';
import { makeDemPatch, type DemMeta } from '../../../src/world/demTerrain.ts';
import { mapFromGameX, mapFromGameZ, mapShareX, mapShareY } from '../../../src/ui/spaceMapLayers.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const SHIPPED = { ...MAP_PICTURE_TUNE };

// A synthetic raster: 257 samples over 4096 m, flat at nought but one peak, 300 m tall, at a known sample.
const n = 257;
const size = 4096;
const meta: DemMeta = { mapWidthInMeters: size, base: { samples: n, metresPerSample: size / (n - 1), minHeight: 0, maxHeight: 300 } };
const raw = new Uint16Array(n * n);
const pu = 190;
const pv = 60;
for (let v = 0; v < n; v++) {
  for (let u = 0; u < n; u++) {
    const d2 = (u - pu) ** 2 + (v - pv) ** 2;
    raw[v * n + u] = Math.round(65535 * Math.exp(-d2 / 18));
  }
}
const patch = makeDemPatch(raw.buffer, meta, { feather: 0, size });
// The peak's game point: a sample's place in the patch (u with x, v with z, about its centre).
const peakX = (pu / (n - 1)) * size - size / 2;
const peakZ = (pv / (n - 1)) * size - size / 2;
ok(Math.abs((patch.heightAt(peakX, peakZ, () => 0) ?? 0) - 300) < 1e-6, "the raster's peak stands where its sample is");

/** A lake of ours over a square of the game's frame, its surface at 10 m, its look's colour named; and a painted family east of x = 0. */
const lake = { x0: 800, x1: 1400, z0: -1400, z1: -800, h: 10 };
const LAKE = [20, 90, 200];
const PAINT = [200, 80, 40];
const PALETTE = [120, 110, 90];
const PLANET_WATER = 0x2f6f8a;
const src = (island: boolean): DemMapSource => ({
  size,
  heightAt: (gx, gz) => {
    const h = patch.heightAt(gx, gz, () => 0) ?? 0;
    // An island in the lake: ground over the surface in its middle.
    if (island && Math.abs(gx - 1100) < 60 && Math.abs(gz + 1100) < 60) return 40;
    return h;
  },
  groundColour: (gx, _gz, _h, out) => {
    const c = gx > 0 ? PAINT : PALETTE;
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  },
  waterAt: (gx, gz) => (gx >= lake.x0 && gx <= lake.x1 && gz >= lake.z0 && gz <= lake.z1 ? lake.h : -Infinity),
  waterColour: (gx, gz, out) => {
    if (!(gx >= lake.x0 && gx <= lake.x1 && gz >= lake.z0 && gz <= lake.z1)) return false;
    out[0] = LAKE[0];
    out[1] = LAKE[1];
    out[2] = LAKE[2];
    return true;
  },
  planetWater: PLANET_WATER,
});

/** A pixel's (i, j) for a game point, by the maps' own frame about (0, 0). */
const frame = { width: size, x: 0, z: 0 };
const pixelOf = (m: DemMapMaker, gx: number, gz: number) => ({
  i: Math.floor(mapShareX(frame, mapFromGameX(0, gx)) * m.px),
  j: Math.floor(mapShareY(frame, mapFromGameZ(0, gz)) * m.px),
});
const at = (m: DemMapMaker, i: number, j: number) => {
  const o = (j * m.px + i) * 4;
  return [m.data[o], m.data[o + 1], m.data[o + 2]];
};
const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

{
  tuneMapPicture({ px: 256, sliceRows: 32, sliceMs: 1000, shade: 0.6 });
  const m = new DemMapMaker(src(true));
  while (!m.step(1000));
  // The peak: the pixel the frame puts it on holds the highest height of the picture.
  const heights = (m as unknown as { heights: Float32Array }).heights;
  let best = 0;
  for (let k = 1; k < heights.length; k++) if (heights[k] > heights[best]) best = k;
  const bi = best % m.px;
  const bj = Math.floor(best / m.px);
  const want = pixelOf(m, peakX, peakZ);
  ok(Math.abs(bi - want.i) <= 1 && Math.abs(bj - want.j) <= 1, `the peak's pixel (${bi}, ${bj}) is where the maps' frame puts the peak (${want.i}, ${want.j}): x mirrored, z up the picture`);
  ok(m.gameX(want.i) * peakX > 0 && m.gameZ(want.j) * peakZ > 0, 'and its pixel stands on the same side of the middle both ways');
  // The lake: its own colour inside the outline where it stands over the ground, the island's ground in its middle.
  const inLake = pixelOf(m, 1300, -900);
  const onIsland = pixelOf(m, 1100, -1100);
  ok(same(at(m, inLake.i, inLake.j), LAKE), "a lake of ours is drawn in its look's own colour inside its outline");
  ok(!same(at(m, onIsland.i, onIsland.j), LAKE) && at(m, onIsland.i, onIsland.j)[0] > 100, 'and not where the ground stands over its surface (an island stays ground)');
  const out = pixelOf(m, 1600, -1100);
  ok(!same(at(m, out.i, out.j), LAKE), 'nor outside its outline');
  // The painted family east of the middle, the palette west, on flat ground unshaded.
  const east = pixelOf(m, 1500, 1500);
  const west = pixelOf(m, -1500, 1500);
  ok(same(at(m, east.i, east.j), PAINT) && same(at(m, west.i, west.j), PALETTE), "a painted family's cells in its colour and the rest in the palette's, flat ground taking no shade");
  // The peak's sunward slope lighter than its far one: the light at 315 degrees, the picture's top left, is the game's +x
  // (the picture's left, x mirrored) and +z (its top), so the slope facing (+x, +z) is lit and the one facing away shaded.
  // (Read on a picture with no island, whose sharp edge would be a slope of its own beside the peak's.)
  const m0 = new DemMapMaker(src(false));
  while (!m0.step(1000));
  const lit = pixelOf(m0, peakX + 60, peakZ + 60);
  const dark = pixelOf(m0, peakX - 60, peakZ - 60);
  const sum = (c: number[]) => c[0] + c[1] + c[2];
  // The peak stands east of the middle, on the painted family.
  const flatSum = sum(PAINT);
  ok(sum(at(m0, lit.i, lit.j)) > flatSum && sum(at(m0, dark.i, dark.j)) < flatSum, `the hillshade lights the slope facing the light at the top left (${sum(at(m0, lit.i, lit.j))}) over the flat ground's colour (${flatSum}) and shades the one facing away (${sum(at(m0, dark.i, dark.j))})`);
  // And the light turned to the bottom right turns the shade round.
  tuneMapPicture({ sunAz: 135 });
  const r = new DemMapMaker(src(false));
  while (!r.step(1000));
  tuneMapPicture({ sunAz: SHIPPED.sunAz });
  ok(sum(at(r, lit.i, lit.j)) < flatSum && sum(at(r, dark.i, dark.j)) > flatSum, `and the light from the bottom right lights the other slope (${sum(at(r, dark.i, dark.j))}) and shades this one (${sum(at(r, lit.i, lit.j))})`);
  ok(m.slices === m.px / 32 && m.sliceCount === m.px / 32, `the picture is ${m.slices} slices of 32 rows (px / sliceRows)`);
}

{
  // A water with no look of its own takes the planet's colour; a tune's water colour stands in for it.
  tuneMapPicture({ px: 64, sliceRows: 8, sliceMs: 1000 });
  const s = src(false);
  s.waterColour = () => false;
  const m = new DemMapMaker(s);
  while (!m.step(1000));
  const p = pixelOf(m, 1100, -1100);
  ok(same(at(m, p.i, p.j), [(PLANET_WATER >> 16) & 255, (PLANET_WATER >> 8) & 255, PLANET_WATER & 255]), "water with no look of its own takes the planet's colour");
  tuneMapPicture({ waterColour: '#102030' });
  const m2 = new DemMapMaker(s);
  while (!m2.step(1000));
  ok(same(at(m2, p.i, p.j), [16, 32, 48]), "and the tune's water colour where one is named");
  tuneMapPicture({ waterColour: '' });
}

{
  // The slices against a clock: a stand-in clock where each row costs 0.25 ms, a budget of 2 ms: eight rows a frame, never a
  // ninth begun past it, and one row always made even when one row alone costs more than the budget.
  tuneMapPicture({ px: 128, sliceRows: 32 });
  let t = 0;
  const s = src(false);
  const slow: DemMapSource = { ...s, heightAt: (gx, gz) => ((t += 0.25 / 128), s.heightAt(gx, gz)) };
  const m = new DemMapMaker(slow, MAP_PICTURE_TUNE, () => t);
  let frames = 0;
  let rowsMost = 0;
  while (!m.done) {
    const before = m.row;
    m.step(2);
    frames++;
    rowsMost = Math.max(rowsMost, m.row - before);
  }
  ok(m.worstMs <= 2 + 1e-9 && rowsMost <= 8, `no frame past its 2 ms budget (${m.worstMs.toFixed(3)} ms the worst, ${rowsMost} rows at most)`);
  ok(m.slices === 4 && frames >= 16, `four slices of 32 rows over ${frames} frames`);
  let t2 = 0;
  const slower: DemMapSource = { ...s, heightAt: (gx, gz) => ((t2 += 5 / 128), s.heightAt(gx, gz)) };
  const m2 = new DemMapMaker(slower, MAP_PICTURE_TUNE, () => t2);
  m2.step(2);
  ok(m2.row === 1, 'a row costing more than the budget is still made, one a frame');
}

{
  // Monument's own raster, committed, at the shipped 1024 px: made in its slices, each frame's cost measured in node.
  const dir = new URL('../../../public/dem/monument/', import.meta.url);
  if (!existsSync(new URL('base16.raw', dir))) console.log("note Monument's raster is not in this checkout: its picture is left out");
  else {
    tuneMapPicture({ ...SHIPPED });
    const mon = makeDemPatch(new Uint8Array(readFileSync(new URL('base16.raw', dir))).buffer, JSON.parse(readFileSync(new URL('base.json', dir), 'utf8')) as DemMeta, { size: 16288, lift: -1490.344970703125, feather: 0 });
    // Its frames are held to the budget on a stand-in clock (a row of heights a sixteenth of a millisecond, near what node
    // takes), never the machine's own, whose frames a busy test run makes as long as it likes; the real milliseconds are said.
    let t = 0;
    const perHeight = 1 / 16 / 1024;
    const s: DemMapSource = { size: mon.size, heightAt: (gx, gz) => ((t += perHeight), mon.heightAt(gx, gz, () => 0) ?? 0), groundColour: (_x, _z, _h, out) => out.set(PALETTE), waterAt: () => -Infinity, waterColour: () => false, planetWater: PLANET_WATER };
    const m = new DemMapMaker(s, MAP_PICTURE_TUNE, () => t);
    const t0 = performance.now();
    let frames = 0;
    let rowsMost = 0;
    while (!m.done) {
      const before = m.row;
      m.step();
      frames++;
      rowsMost = Math.max(rowsMost, m.row - before);
    }
    const wall = performance.now() - t0;
    ok(m.px === 1024 && m.slices === 1024 / SHIPPED.sliceRows, `Monument's picture: ${m.px} px in ${m.slices} slices (px / sliceRows)`);
    // A row costs 1024 heights; the budget of 2 ms then holds 32 rows, and no row is begun past it.
    const rowCost = 1024 * perHeight;
    const most = Math.floor(SHIPPED.sliceMs / rowCost);
    ok(m.worstMs <= SHIPPED.sliceMs + 1e-9 && rowsMost <= most && frames >= Math.ceil(m.px / most), `on the stand-in clock no frame past its ${SHIPPED.sliceMs} ms budget (${rowsMost} rows a frame at most of the ${most} it holds, over ${frames} frames)`);
    console.log(`note Monument's picture in node: ${wall.toFixed(0)} ms of real time over ${frames} frames (said, not held: the machine's clock is the run's to make long)`);
    let lo = 255;
    let hi = 0;
    for (let k = 0; k < m.data.length; k += 4) {
      lo = Math.min(lo, m.data[k]);
      hi = Math.max(hi, m.data[k]);
    }
    ok(hi - lo > 40, `its relief shows in the shade (${lo} to ${hi} in red over one ground colour)`);
  }
}

{
  // The picture's source over a world (`demMapSourceOf`, what `App.makeDemMap` hands its maker): the ground's linear colour
  // to sRGB bytes by three's own curve, a tiled world's colour map laid over it and an untiled world's not, and a lake's own
  // look's colour where one is named (each look's text read once, two looks taken in turn each its own).
  const THREE = await import('three');
  const kept = { r: 0.5, g: 0.25, b: 0.02 };
  const tint = [128, 255, 64];
  let mapAsked = 0;
  const world = (tiled: boolean): DemMapWorld => ({
    size,
    heightAt: () => 0,
    groundLinear: () => kept,
    tiled,
    colourMapAt: (_x, _z, out) => {
      mapAsked++;
      out[0] = tint[0];
      out[1] = tint[1];
      out[2] = tint[2];
    },
    waterAt: () => -Infinity,
    waterLookAt: (gx) => (gx > 100 ? '#336699' : gx > 0 ? '#a1b2c3' : gx > -100 ? 'murky' : null),
    planetWater: PLANET_WATER,
  });
  const want = new THREE.Color(kept.r, kept.g, kept.b).convertLinearToSRGB();
  const out = new Uint8Array(3);
  const plain = demMapSourceOf(world(false));
  plain.groundColour(0, 0, 0, out);
  ok(out[0] === Math.trunc(want.r * 255) && out[1] === Math.trunc(want.g * 255) && out[2] === Math.trunc(want.b * 255) && mapAsked === 0, `the ground's linear colour carried into sRGB by three's own curve (${[...out].join(', ')}), an untiled world's colour map never asked`);
  const tiled = demMapSourceOf(world(true));
  tiled.groundColour(0, 0, 0, out);
  ok(mapAsked === 1 && out[0] === Math.trunc((want.r * 255 * tint[0]) / 255) && out[1] === Math.trunc((want.g * 255 * tint[1]) / 255) && out[2] === Math.trunc((want.b * 255 * tint[2]) / 255), `a tiled world's colour map laid over it (${[...out].join(', ')})`);
  const w = new Uint8Array(3);
  ok(tiled.waterColour(200, 0, w) && w[0] === 0x33 && w[1] === 0x66 && w[2] === 0x99, "a lake's own look's colour where it names one");
  ok(tiled.waterColour(50, 0, w) && w[0] === 0xa1 && w[1] === 0xb2 && w[2] === 0xc3 && tiled.waterColour(200, 0, w) && w[0] === 0x33, 'and two looks taken in turn are each their own');
  ok(!tiled.waterColour(-50, 0, w) && !tiled.waterColour(-200, 0, w), "a look that is no colour, and water naming none, take the planet's (or the tune's)");
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const make = /private makeDemMap\(size: number\): DemMapMaker \{([\s\S]*?)\n  \}/.exec(main)?.[1] ?? '';
  ok(/demMapSourceOf\(\{/.test(make) && /groundLinear: \(gx, gz\) => world\.groundColorAt\(gx, gz, c\),/.test(make) && /tiled: t\.tiled,/.test(make) && /colourMapAt: \(gx, gz, out\) => t\.demColourAt\(gx, gz, out\),/.test(make) && /waterLookAt: \(gx, gz\) => \(t\.waterTableAt\(gx, gz\) as \{ ours\?: \{ look\?: \{ color\?: string \} \} \} \| null\)\?\.ours\?\.look\?\.color,/.test(make), "the game hands it the world's own family colour, tiling, colour map and a lake's own look");
  const worldTs = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  ok(/this\.terrain\.demShader!\.familyAt\(x, z, this\.terrainHeightAt\)/.test(worldTs) && /private readonly terrainHeightAt = \(gx: number, gz: number\): number => this\.terrain\.heightAt\(gx, gz\);/.test(worldTs), "a real-elevation world's family is asked with one height function made once, not a closure a pixel");
}

{
  // The debounce.
  ok(!remakeDue(Number.NaN, 1e9) && !remakeDue(1000, 1000 + SHIPPED.debounceMs - 1) && remakeDue(1000, 1000 + SHIPPED.debounceMs), `an edit landing asks for the picture again once ${SHIPPED.debounceMs} ms have passed, never before, and nothing edited asks nothing`);
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/if \(kind === 'heights'\) return \(pack, rev\) => \(this\.madeMapEdit\(\), void this\.reloadHeights\(pack, rev\)\);/.test(main) && /if \(kind === 'paint'\) return \(pack, rev\) => \(this\.madeMapEdit\(\), void this\.reloadPaint\(pack, rev\)\);/.test(main) && /if \(kind === 'water'\) return \(pack, rev\) => \(this\.madeMapEdit\(\), void this\.reloadWater\(pack, rev\)\);/.test(main), "the dev server's word about a heights, paint or water file asks for the picture again");
  ok(/if \(hf \|\| pf \|\| wf\) this\.madeMapEdit\(\);/.test(main), "and so does the world editor's own write of one");
  ok(/if \(!m \|\| !m\.step\(MAP_PICTURE_TUNE\.sliceMs\)\) return;/.test(main) && /this\.stepMadeMap\(\);/.test(main), 'the frame makes it a few rows at a time');
  ok(/setMadePicture\(pack, bitmap, \{ width: m\.size, x: 0, z: 0 \}, blob \? URL\.createObjectURL\(blob\) : ''\);/.test(main), 'and hands every map the picture over the very frame this test reads it by');
  ok(/if \(!planet \|\| planet\.space \|\| planet\.instances \|\| !planet\.dem \|\| this\.traveling \|\| !this\.inWorld\) return;/.test(main), 'only on a real-elevation world, and never mid-travel');
}

tuneMapPicture({ ...SHIPPED });
console.log(`demMap: ${checks} checks passed`);
