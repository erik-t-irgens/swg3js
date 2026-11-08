// The far ground's albedo (the horizon pass's first wave, DESIGN.md §2.5): the decode worker's composition -- a tile of
// one family its layer's mean outright, a tile of more looked up in the world's memo by its signature -- held to a slow
// mirror that composes every tile at sixteen places through `composeTile` with the masks, no memo and no fast path, on
// 2,000 random cells of a stand-in field (families in patches, so tiles of two to four families are common), within a
// level of sRGB; and the detail window's texels against each tile's greatest share at its middle. The tables are a
// stand-in's (the packs' own pictures are PNGs node does not decode); the rule is the tile program's own (`tileLayers`).
//
// Run: node tools/swg/tests/horizonCompose.test.ts
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { childChoiceAt } from '../../../src/swg/terrain/generator.ts';
import { composeTile, srgbEncode } from '../../../src/world/groundMath.ts';
import { tileLayers, type GroundTiler } from '../../../src/world/groundTiles.ts';
import { ALBEDO_SCALE, DETAIL_SIZE, TileComposer, composeAlbedo, decodeBake, detailWindow, encByte, layerMeans, maskSampler, type TileTables } from '../../../src/world/horizon/horizonDecode.ts';
import { HORIZON_FORMAT, HORIZON_SECTIONS, encodeHeights, planBake, readHorizonHeader, sectionSize, type HorizonHeader } from '../../../src/world/horizon/horizonFile.ts';
import { LEAF, bakeHeightAt } from '../../../src/world/horizon/horizonMath.ts';
import { tileTablesOf } from '../../../src/world/horizon/horizonField.ts';
import { groundShift } from '../../../src/world/groundTiles.ts';
import { makeTiler } from '../../../src/world/terrainTextures.ts';
import type { ShaderGroup } from '../../../src/swg/terrain/generator.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
// Masks: the quarter a soft top-left corner (soft enough that its middle is past a half, so a tile's fourth layer can hold the
// greatest share there), the half a soft left side, the three-quarter all but a soft bottom-right.
const ms = 32;
const masks = new Uint8Array(ms * ms * 3);
for (let y = 0; y < ms; y++) {
  for (let x = 0; x < ms; x++) {
    const u = (x + 0.5) / ms;
    const v = (y + 0.5) / ms;
    const s = (t: number) => Math.min(1, Math.max(0, t));
    masks[y * ms + x] = Math.round(255 * s((0.75 - u) * 3.2) * s((0.75 - v) * 3.2));
    masks[ms * ms + y * ms + x] = Math.round(255 * s((0.6 - u) * 4));
    masks[2 * ms * ms + y * ms + x] = Math.round(255 * (1 - s((u - 0.4) * 4) * s((v - 0.4) * 4)));
  }
}
const F = 6;
const layerOf = new Uint8Array(256 * 256);
const rankOf = new Float64Array(256);
for (let f = 1; f <= F; f++) {
  rankOf[f] = (f * 37) % 11;
  for (let c = 0; c < 256; c++) layerOf[f * 256 + c] = (f - 1) * 3 + (c % 3);
}
const means = new Float32Array(256 * 3);
for (let l = 0; l < F * 3; l++) for (let k = 0; k < 3; k++) means[l * 3 + k] = 0.05 + 0.4 * rnd();
const t: TileTables = { layerOf, rankOf, corners: [0, 1, 2, 3], means, masks, ms, tintMode: 2, gainCap: 1.6, reference: { rgb: [0.55, 0.5, 0.45], luminance: 0.5 }, add: false, painted: true };
// A stand-in field: 160 by 160 pattern corners from raw (-640, -640), families in patches.
const n = 160;
const ground = { x0: -640, z0: -640, step: 8, nx: n, nz: n };
const fam = new Uint8Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) fam[j * n + i] = 1 + (Math.floor(i / 5 + Math.sin(j * 0.21) * 3) + Math.floor(j / 7)) % F;
// And a patch where every two by two of corners is four families, so tiles of four layers stand there.
for (let j = 100; j < 120; j++) for (let i = 100; i < 120; i++) fam[j * n + i] = 1 + (i % 2) + 2 * (j % 2);
const colour = new Uint8Array(n * n * 3);
for (let k = 0; k < colour.length; k++) colour[k] = 120 + Math.floor(120 * rnd());
const header = { fine: { x0: -640, z0: -640, step: 8, nx: n, nz: n, lo: 0, q: 1 }, ground, colour: { x0: -640, z0: -640, step: 8, nx: n, nz: n }, coarse: { x0: -640, z0: -640, step: 64, nx: 21, nz: 21, lo: 0, q: 1 }, sections: [], format: 1, source: {} } as unknown as HorizonHeader;
const fast = composeAlbedo(t, header, fam, colour);

// The slow mirror, its rules written out here rather than taken from the module under test: the corner a 4 m pole takes
// its family from (`snapFamilies`: the 8 m pattern corner nearest it, a tie -- four metres past a corner -- going to the
// corner above), the tiler read straight off the tables, and the tint (mode 2: the bytes' Rec. 709 luminance, the gain
// the lesser of one over the reference's and the cap over the pole's, then sRGB decoded).
const sample = maskSampler(masks, ms);
const tiler: GroundTiler = { rank: (f) => rankOf[f], layer: (f, c) => layerOf[f * 256 + c], corners: [0, 1, 2, 3] };
const cornerFirst = (w: number): number => {
  const r = ((w % 8) + 8) % 8;
  return r < 4 ? w - r : w - r + 8;
};
const famFirst = (x: number, z: number): number => {
  const i = (cornerFirst(x) - ground.x0) / 8;
  const j = (cornerFirst(z) - ground.z0) / 8;
  return i < 0 || j < 0 || i >= n || j >= n ? 0 : fam[j * n + i];
};
const decodeFirst = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const tintFirst = (r: number, g: number, b: number): number[] => {
  const c = [r / 255, g / 255, b / 255];
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const gain = Math.min(1 / Math.max(0.5, 1e-3), 1.6 / Math.max(lum, 1e-6));
  return c.map((v) => decodeFirst(v * gain));
};
const fams = new Int32Array(4);
const choices = new Int32Array(4);
const layers = new Uint8Array(4);
const codes = new Uint8Array(3);
const one = [0, 0, 0];
const weights = [0, 0, 0];
const slowTile = (tx: number, tz: number): number[] => {
  fams[0] = famFirst(tx, tz);
  fams[1] = famFirst(tx + 4, tz);
  fams[2] = famFirst(tx, tz + 4);
  fams[3] = famFirst(tx + 4, tz + 4);
  choices[0] = childChoiceAt(tx, tz);
  choices[1] = childChoiceAt(tx + 4, tz);
  choices[2] = childChoiceAt(tx, tz + 4);
  choices[3] = childChoiceAt(tx + 4, tz + 4);
  tileLayers(fams, choices, tiler, layers, codes);
  const acc = [0, 0, 0];
  for (let q = 0; q < 4; q++) {
    for (let p = 0; p < 4; p++) {
      composeTile((i, o) => {
        o[0] = means[layers[i] * 3];
        o[1] = means[layers[i] * 3 + 1];
        o[2] = means[layers[i] * 3 + 2];
      }, codes, (p + 0.5) / 4, (q + 0.5) / 4, sample, false, true, one);
      for (let k = 0; k < 3; k++) acc[k] += one[k] / 16;
    }
  }
  return acc;
};
const toLevel = (v: number) => Math.round(255 * Math.min(1, Math.max(0, (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055))));
let worst = 0;
let multi = 0;
for (let s = 0; s < 2000; s++) {
  const i = 1 + Math.floor(rnd() * (n - 2));
  const j = 1 + Math.floor(rnd() * (n - 2));
  const X = -640 + i * 8;
  const Z = -640 + j * 8;
  const sum = [0, 0, 0];
  for (const [dx, dz] of [[-4, -4], [0, -4], [-4, 0], [0, 0]]) {
    const c = slowTile(X + dx, Z + dz);
    if (codes[0] > 0) multi++;
    for (let k = 0; k < 3; k++) sum[k] += c[k] / 4;
  }
  const tint = tintFirst(colour[(j * n + i) * 3], colour[(j * n + i) * 3 + 1], colour[(j * n + i) * 3 + 2]);
  for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(toLevel((sum[k] * tint[k]) / ALBEDO_SCALE) - fast.rgba[(j * n + i) * 4 + k]));
}
ok(multi > 500, `the stand-in field has tiles of two to four families (${multi} of 8,000 tiles)`);
ok(worst <= 1, `the worker's albedo is the slow mirror's within a level of sRGB on 2,000 cells (worst ${worst}), its memo holding ${fast.memo} signatures`);
ok(fast.rgba.every((v, k) => k % 4 !== 3 || v === 0), 'the alpha is nought everywhere');

// The rolling pole rows (each pole's family and choice once) are the per-tile walk to the byte: every cell's tiles
// composed one by one through `colourAt`, summed in the cell's own order, through the same encode.
{
  const comp = new TileComposer(t, fam, ground);
  const tile = [0, 0, 0];
  let differ = 0;
  for (let j = 0; j < n && differ < 5; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = -640 + i * 8 - 4;
      const z0 = -640 + j * 8 - 4;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let q = 0; q < 2; q++) for (let p = 0; p < 2; p++) {
        comp.colourAt(x0 + p * 4, z0 + q * 4, tile);
        r += tile[0];
        g += tile[1];
        b += tile[2];
      }
      const ti = tintFirst(colour[(j * n + i) * 3], colour[(j * n + i) * 3 + 1], colour[(j * n + i) * 3 + 2]);
      const want = [r, g, b].map((v, k) => encByte(Math.min(1, Math.max(0, (v * 0.25 * ti[k]) / ALBEDO_SCALE))));
      for (let k = 0; k < 3; k++) if (want[k] !== fast.rgba[(j * n + i) * 4 + k]) differ++;
    }
  }
  ok(differ === 0, `the albedo's rolling pole rows are the per-tile walk byte for byte over ${n * n} cells`);
}
// The byte table is the formula's rounding.
{
  let off = 0;
  for (let s = 0; s < 200000; s++) {
    const x = s < 1000 ? s / 999 : rnd();
    if (encByte(x) !== Math.round(srgbEncode(x) * 255)) off++;
  }
  ok(off === 0, 'the albedo\'s sRGB byte table answers Math.round(srgbEncode(x) * 255) on 200,000 values');
}
// The memo past its table's first size (2,048 signatures) answers every signature as it was composed.
{
  const comp = new TileComposer(t, fam, ground);
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  let bad = 0;
  const N = 6000;
  for (let pass = 0; pass < 2; pass++) {
    for (let s = 0; s < N; s++) {
      // Base 18 digits of s: every s its own layers, with a valid code (a mask kind and a turn).
      comp.layers[0] = s % 18;
      comp.layers[1] = Math.floor(s / 18) % 18;
      comp.layers[2] = Math.floor(s / 324) % 18;
      comp.layers[3] = Math.floor(s / 5832) % 18;
      comp.codes[0] = 1 + (s % 12);
      comp.codes[1] = 0;
      comp.codes[2] = 0;
      comp.colourOf(4, a, true);
      comp.colourOf(4, b, false);
      // The memo keeps its colours as float32 (as it always has): a hit is the composition rounded to one.
      for (let k = 0; k < 3; k++) if (Math.fround(a[k]) !== Math.fround(b[k])) bad++;
    }
  }
  ok(bad === 0 && comp.memoSize > 4096, `the memo's table grown to ${comp.memoSize} signatures answers each as composed`);
}

// The detail window: each tile's own layer, the greatest share at its middle.
const win = detailWindow(t, header, fam, 0, 0);
let wrong = 0;
let tiles = 0;
const winners = [0, 0, 0, 0];
for (let tz = -600; tz < 600; tz += 4) for (let tx = -600; tx < 600; tx += 4) {
  tiles++;
  fams[0] = famFirst(tx, tz);
  fams[1] = famFirst(tx + 4, tz);
  fams[2] = famFirst(tx, tz + 4);
  fams[3] = famFirst(tx + 4, tz + 4);
  choices[0] = childChoiceAt(tx, tz);
  choices[1] = childChoiceAt(tx + 4, tz);
  choices[2] = childChoiceAt(tx, tz + 4);
  choices[3] = childChoiceAt(tx + 4, tz + 4);
  const count = tileLayers(fams, choices, tiler, layers, codes);
  weights.fill(0);
  composeTile((_i, o) => (o[0] = 0), codes, 0.5, 0.5, sample, false, true, one, weights);
  const share = [(1 - weights[0]) * (1 - weights[1]) * (1 - weights[2]), weights[0] * (1 - weights[1]) * (1 - weights[2]), weights[1] * (1 - weights[2]), weights[2]];
  let best = 0;
  for (let k = 1; k < count; k++) if (share[k] > share[best]) best = k;
  const m = (v: number) => ((v % DETAIL_SIZE) + DETAIL_SIZE) % DETAIL_SIZE;
  winners[best]++;
  if (win[m(tz / 4) * DETAIL_SIZE + m(tx / 4)] !== layers[best]) {
    if (!wrong) console.log(`first wrong at ${tx},${tz}: window ${win[m(tz / 4) * DETAIL_SIZE + m(tx / 4)]}, want ${layers[best]} of ${[...layers.slice(0, count)]}, shares ${share.map((v) => v.toFixed(3))}, codes ${[...codes]}`);
    wrong++;
  }
}
ok(wrong === 0 && winners[1] > 0 && winners[2] > 0 && winners[3] > 0, `the detail window holds each tile's layer of the greatest share at its middle (${tiles} tiles; the base and the three overlays win ${winners.join(', ')})`);

// ---------------------------------------------------------------- the whole decode on a made bake
// A small bake laid out by `planBake` about an odd centre (both of the ground's shifts one), its heights a known field that
// slopes and folds differently along raw x and z (so a mirrored axis puts a node's heights hundreds of metres off), its
// sections deflated as the converter writes them, decoded by `decodeBake` with tables made by `tileTablesOf` over a real
// `makeTiler`; the pyramid, the normals, the coarse albedo and the layers' means held to what is worked out here.
{
  const centre = { x: 1269, z: -3601 };
  const shift = groundShift(centre.x, centre.z);
  const plan = planBake(512, centre, { margin: 256, farMargin: 1536 });
  const hRaw = (rx: number, rz: number) => 0.35 * rx - 0.12 * rz + 30 * Math.sin(rx / 97) + 20 * Math.cos(rz / 53);
  const fill = (lat: { x0: number; z0: number; step: number; nx: number; nz: number }) => {
    const h = new Float32Array(lat.nx * lat.nz);
    for (let j = 0; j < lat.nz; j++) for (let i = 0; i < lat.nx; i++) h[j * lat.nx + i] = hRaw(lat.x0 + i * lat.step, lat.z0 + j * lat.step);
    return h;
  };
  const fineH = fill(plan.fine);
  const coarseH = fill(plan.coarse);
  const fe = encodeHeights(fineH, plan.fine.nx, plan.fine.nz);
  const ce = encodeHeights(coarseH, plan.coarse.nx, plan.coarse.nz);
  const fams3 = (lat: { nx: number; nz: number }) => Uint8Array.from({ length: lat.nx * lat.nz }, (_, k) => 1 + ((Math.floor((k % lat.nx) / 3) + Math.floor(k / lat.nx / 4)) % 3));
  const rgb = (cnt: number) => Uint8Array.from({ length: cnt * 3 }, (_, k) => 100 + ((k * 37) % 120));
  const header0 = { format: HORIZON_FORMAT, source: { generator: 1, trn: { length: 1, sha1: 'x' }, inputs: 'y', centre, layers: { sha1: 'z', list: [] }, lifeDay: false, made: 'poles' }, fine: { ...plan.fine, lo: fe.lo, q: fe.q }, ground: plan.ground, colour: plan.colour, coarse: { ...plan.coarse, lo: ce.lo, q: ce.q } };
  const raw: Record<string, Uint8Array> = {
    heights: fe.bytes,
    families: fams3(plan.ground),
    colour: rgb(plan.colour.nx * plan.colour.nz),
    coarseHeights: ce.bytes,
    coarseFamilies: fams3(plan.coarse),
    coarseColour: rgb(plan.coarse.nx * plan.coarse.nz),
  };
  const parts: Uint8Array[] = [];
  const sections: { name: (typeof HORIZON_SECTIONS)[number]; offset: number; length: number; size: number }[] = [];
  let at = 0;
  for (const name of HORIZON_SECTIONS) {
    const z = new Uint8Array(deflateSync(raw[name]));
    sections.push({ name, offset: at, length: z.length, size: sectionSize(header0 as never, name) });
    parts.push(z);
    at += z.length;
  }
  const bin = new Uint8Array(at);
  let o = 0;
  for (const p of parts) {
    bin.set(p, o);
    o += p.length;
  }
  const read = readHorizonHeader({ ...header0, sections }, { generator: 1, centre, binLength: bin.length }, 'made');
  ok('header' in read, 'the made bake reads as a whole header');
  const header = (read as { header: HorizonHeader }).header;
  // The tables over a real tiler: three families (three, two and one alternates), ranks and layers of their own.
  const group = { families: new Map([[1, { id: 1, children: [{ weight: 1 }, { weight: 2 }, { weight: 1 }] }], [2, { id: 2, children: [{ weight: 1 }, { weight: 1 }] }], [3, { id: 3, children: [{ weight: 1 }] }]]) } as unknown as ShaderGroup;
  const live = makeTiler(new Map([[1, [0, 1, 2]], [2, [3, 4]], [3, [5]]]), new Map([[1, 2], [2, 0], [3, 1]]), group, false);
  const size = 8;
  const depth = 6;
  const arr = new Uint8Array(size * size * 4 * depth);
  for (let l = 0; l < depth; l++) for (let k = 0; k < size * size; k++) arr.set([20 + 30 * l, 40 + 20 * l, 60 + 10 * l, 255], (l * size * size + k) * 4);
  const tables = tileTablesOf({ tiler: live, colour: arr, size, depth, masks, ms, reference: { rgb: [0.5, 0.5, 0.5], luminance: 0.5 } });
  let tableOff = 0;
  for (let f = 0; f < 256; f++) {
    if (tables.rankOf[f] !== live.rank(f)) tableOff++;
    for (let c = 0; c < 256; c++) if (tables.layerOf[f * 256 + c] !== (live.layer(f, c) & 255)) tableOff++;
  }
  ok(tableOff === 0 && tables.corners.join() === live.corners.join(), "the tile tables are the live tiler's layer, rank and corners at every family and choice");
  let meanOff = 0;
  for (let l = 0; l < depth; l++) {
    const want = [20 + 30 * l, 40 + 20 * l, 60 + 10 * l].map((b) => decodeFirst(b / 255));
    for (let k = 0; k < 3; k++) meanOff = Math.max(meanOff, Math.abs(tables.means[l * 3 + k] - want[k]));
  }
  ok(meanOff < 1e-6 && layerMeans(arr, size, depth).length >= 256 * 3, `each layer's mean is its bytes sRGB decoded (worst ${meanOff.toExponential(1)})`);
  const d = await decodeBake(header, bin, tables, centre, shift, { rx: centre.x, rz: centre.z });
  // The pyramid, walked in the game's frame: every fine and coarse sample, and the bake's own surface at random places,
  // inside the [lo, hi] of the level-0 cell it stands in; no cell inside the coarse extent left NaN; each level above its four.
  const pyr = d.pyramid;
  const cellOf = (gx: number, gz: number) => {
    const ci = Math.floor((gx - pyr.x0) / LEAF);
    const cj = Math.floor((gz - pyr.z0) / LEAF);
    return ci >= 0 && cj >= 0 && ci < pyr.n && cj < pyr.n ? cj * pyr.n + ci : -1;
  };
  let outside = 0;
  let walked = 0;
  const hold = (gx: number, gz: number, h: number) => {
    const k = cellOf(gx, gz);
    walked++;
    if (k < 0 || !(pyr.lo[0][k] <= h + 1e-3 && h <= pyr.hi[0][k] + 1e-3)) outside++;
  };
  for (const [lat, h] of [[header.fine, d.fine], [header.coarse, d.coarse]] as const) {
    for (let j = 0; j < lat.nz; j++) for (let i = 0; i < lat.nx; i++) {
      const rx = lat.x0 + i * lat.step;
      const rz = lat.z0 + j * lat.step;
      // A sample on a cell's corner stands in four: the cell to its north-east is the one `cellOf` names, which holds it.
      hold(centre.x - rx, rz - centre.z, h[j * lat.nx + i]);
    }
  }
  const fineG = { ...header.fine, h: d.fine };
  const coarseG = { ...header.coarse, h: d.coarse };
  const cxs = [header.coarse.x0, header.coarse.x0 + (header.coarse.nx - 1) * header.coarse.step];
  const czs = [header.coarse.z0, header.coarse.z0 + (header.coarse.nz - 1) * header.coarse.step];
  for (let s = 0; s < 20000; s++) {
    const rx = cxs[0] + rnd() * (cxs[1] - cxs[0]);
    const rz = czs[0] + rnd() * (czs[1] - czs[0]);
    hold(centre.x - rx, rz - centre.z, bakeHeightAt(fineG, coarseG, rx, rz));
  }
  let nan = 0;
  for (let cj = 0; cj < pyr.n; cj++) for (let ci = 0; ci < pyr.n; ci++) {
    const gx0 = pyr.x0 + ci * LEAF;
    const gz0 = pyr.z0 + cj * LEAF;
    const inside = centre.x - (gx0 + LEAF) >= cxs[0] && centre.x - gx0 <= cxs[1] && gz0 + centre.z >= czs[0] && gz0 + LEAF + centre.z <= czs[1];
    if (inside && !(pyr.lo[0][cj * pyr.n + ci] === pyr.lo[0][cj * pyr.n + ci])) nan++;
  }
  let upOff = 0;
  for (let L = 1; L < pyr.levels; L++) {
    const m = pyr.n >> L;
    const c = pyr.n >> (L - 1);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      let a = Infinity;
      let b = -Infinity;
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const k = (2 * j + dj) * c + 2 * i + di;
        const l = pyr.lo[L - 1][k];
        if (l === l) {
          a = Math.min(a, l);
          b = Math.max(b, pyr.hi[L - 1][k]);
        }
      }
      const pl = pyr.lo[L][j * m + i];
      if (a <= b ? pl !== a || pyr.hi[L][j * m + i] !== b : pl === pl) upOff++;
    }
  }
  ok(outside === 0 && walked > 20000, `the pyramid holds every sample and the bake's surface in the game's frame (${walked} places, ${outside} outside)`);
  ok(nan === 0 && upOff === 0, `no cell inside the coarse extent is left without a bound, and every level is its four's least and most (${nan} NaN, ${upOff} off)`);
  // The normals against the known field's slope in the game's frame (game x runs against raw x), one step either side.
  const hg = (gx: number, gz: number) => hRaw(centre.x - gx, gz + centre.z);
  let worstN = 0;
  for (const [lat, nm] of [[header.fine, d.fineNormal], [header.coarse, d.coarseNormal]] as const) {
    for (let s = 0; s < 3000; s++) {
      const i = 1 + Math.floor(rnd() * (lat.nx - 2));
      const j = 1 + Math.floor(rnd() * (lat.nz - 2));
      const gx = centre.x - (lat.x0 + i * lat.step);
      const gz = lat.z0 + j * lat.step - centre.z;
      const st = lat.step;
      const sx = (hg(gx + st, gz) - hg(gx - st, gz)) / (2 * st);
      const sz = (hg(gx, gz + st) - hg(gx, gz - st)) / (2 * st);
      const len = Math.sqrt(sx * sx + 1 + sz * sz);
      const k = (j * lat.nx + i) * 2;
      worstN = Math.max(worstN, Math.abs((nm[k] - 127.5) / 127.5 - -sx / len), Math.abs((nm[k + 1] - 127.5) / 127.5 - -sz / len));
    }
  }
  ok(worstN < 0.02, `the baked normals are the field's own in the game's frame within a level and a half (worst ${worstN.toFixed(4)})`);
  // The coarse albedo past the fine colour extent: its own family at the place's choice, at its layer's mean, by its own tint.
  const co = header.coarse;
  const c8 = header.colour;
  let coarseOff = 0;
  let checked = 0;
  for (let s = 0; s < 4000 && checked < 1500; s++) {
    const i = Math.floor(rnd() * co.nx);
    const j = Math.floor(rnd() * co.nz);
    const x = co.x0 + i * co.step;
    const z = co.z0 + j * co.step;
    if (x + co.step / 2 >= c8.x0 && x - co.step / 2 <= c8.x0 + (c8.nx - 1) * c8.step && z + co.step / 2 >= c8.z0 && z - co.step / 2 <= c8.z0 + (c8.nz - 1) * c8.step) continue;
    checked++;
    const f = raw.coarseFamilies[j * co.nx + i];
    const l = live.layer(f, childChoiceAt(x, z) & 255);
    const ti = tintFirst(raw.coarseColour[(j * co.nx + i) * 3], raw.coarseColour[(j * co.nx + i) * 3 + 1], raw.coarseColour[(j * co.nx + i) * 3 + 2]);
    for (let k = 0; k < 3; k++) coarseOff = Math.max(coarseOff, Math.abs(toLevel((tables.means[l * 3 + k] * ti[k]) / ALBEDO_SCALE) - d.coarseAlbedo[(j * co.nx + i) * 4 + k]));
  }
  ok(checked > 500 && coarseOff <= 1, `the coarse albedo past the fine extent is its own family's mean by its tint (${checked} texels, worst ${coarseOff})`);
}

console.log(`\nhorizonCompose: ${checks} checks passed`);
