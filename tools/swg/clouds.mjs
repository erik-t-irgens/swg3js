// What a world's sky is really like, measured off the pictures the client drew it with.
//
// The volumetric clouds need two numbers per world per weather level: how much of the sky is
// covered, and how dark it is. Both are **in the client's own art** and neither is anywhere it can
// be read as a number, so they are measured here.
//
// A cloud sheet is one tiling picture drawn across the sky. Its **mean alpha** is therefore exactly
// how much of the sky that row covers, and its **mean brightness** is how dark that cover is. Over
// the thirteen tiles the retail worlds use, those two numbers order themselves into precisely the
// sky each planet is known for: the storm deck reads 0.85 covered, the lava world's two tiles are
// the darkest of all at 0.17 and 0.22 brightness, the desert's are 0.12 covered and 0.76 bright,
// and the one the emptiest world uses reads 0.007, which is to say a clear sky.
//
// One thing that looks like a mapping and is not. **A higher weather level does not mean more
// cloud.** On most worlds the sheets are *dropped* as the weather rises -- the desert carries
// eighteen rows of cloud at level 0 and none at all above it -- because at that point the row hangs
// a storm effect on the camera instead and a sheet behind it would be pointless. So the level says
// what the weather is doing, and the tile says what the sky looks like, and reading the first as
// the second gets every world backwards.
//
// This reads converted packs and no archive, so it takes no <swg-dir> and nothing about
// `--retail-only` applies to it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodePng } from './png.mjs';

/** The shape written to `<pack>/clouds.json`. */
export const CLOUDS_FORMAT = 1;

/**
 * The per-picture numbers the volumetrics' clouds read (the seventh wave's), written beside `format` and never instead
 * of it: the September loader takes format 1 alone, so a bump would empty its clouds for a player with the master off.
 * A file without this stamp is drawn as heaps at today's coverage.
 */
export const CLOUDS_PICTURES = 2;

/** A picture's kind from its coefficient of variation: 1 a layer at `from` or under, 0 heaps at `to` or over (the clouds' `kindFrom`, `kindTo`). */
export function layeredOf(mean, spread, from = 0.25, to = 1.0) {
  const cov = spread / Math.max(mean, 1e-3);
  const t = 1 - (cov - from) / (to - from);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Measure one cloud sheet: how much of the sky it covers and how dark that cover is.
 *
 * Alpha is the coverage because that is literally what the sheet's alpha does -- it is drawn over
 * the sky and its alpha is how much of the sky it hides. Brightness is taken over the **covered**
 * texels only, weighted by their own alpha: a tile that is nine tenths empty would otherwise report
 * the colour of its empty texels, which are not a cloud and are not what anybody sees.
 */
export function measureTile(png) {
  const img = decodePng(png);
  if (!img) return null;
  const n = img.width * img.height;
  let alpha = 0;
  let solid = 0;
  let lumWeighted = 0;
  let weight = 0;
  // The seventh wave's: the alpha's spread and its tenth, half and ninth tenth, and the alpha-weighted mean colour.
  let alpha2 = 0;
  let rW = 0;
  let gW = 0;
  let bW = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const a = img.rgba[i * 4 + 3] / 255;
    alpha += a;
    if (a > 0.78) solid++;
    const lum = (img.rgba[i * 4] * 0.299 + img.rgba[i * 4 + 1] * 0.587 + img.rgba[i * 4 + 2] * 0.114) / 255;
    lumWeighted += lum * a;
    weight += a;
    alpha2 += a * a;
    rW += img.rgba[i * 4] * a;
    gW += img.rgba[i * 4 + 1] * a;
    bW += img.rgba[i * 4 + 2] * a;
    hist[img.rgba[i * 4 + 3]]++;
  }
  const mean = alpha / n;
  const spread = Math.sqrt(Math.max(0, alpha2 / n - mean * mean));
  const quantile = (q) => {
    const want = q * n;
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen >= want) return v / 255;
    }
    return 1;
  };
  const colourByte = (s) => Math.round(weight > 0 ? s / weight : 255);
  return {
    width: img.width,
    height: img.height,
    /** Mean alpha: the share of sky this sheet covers. */
    coverage: round(mean),
    /** The share of it that is opaque, which is what tells a deck from a haze. */
    solid: round(solid / n),
    /** Mean brightness of what is actually cloud, alpha-weighted. */
    brightness: round(weight > 0 ? lumWeighted / weight : 0),
    // The seventh wave's (`CLOUDS_PICTURES`): how evenly the picture covers (its alpha's spread and three of its
    // quantiles), its alpha-weighted mean colour as sRGB bytes, and its kind read from them (1 a layer, 0 heaps).
    spread: round(spread),
    q10: round(quantile(0.1)),
    q50: round(quantile(0.5)),
    q90: round(quantile(0.9)),
    colour: [colourByte(rW), colourByte(gW), colourByte(bW)],
    layered: round(layeredOf(mean, spread)),
  };
}

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Gather a world's rows into one record per weather level.
 *
 * A level's coverage is the **greatest** of the rows in it rather than the mean, because the rows
 * of one level are different *areas* of the world and not layers of one sky: a player standing in
 * the cloudiest of them should see that area's sky, and averaging it with the clear areas across
 * the map would give nobody's.
 */
export function gatherLevels(blocks, tiles) {
  const byLevel = new Map();
  for (const row of blocks ?? []) {
    const level = row.weatherIndex ?? 0;
    const e = byLevel.get(level) ?? { level, rows: 0, decks: 0, coverage: 0, brightness: 1, tiles: [] };
    e.rows++;
    for (const which of ['cloudBottom', 'cloudTop']) {
      const layer = row[which];
      if (!layer?.file) continue;
      const name = path.basename(layer.file);
      const t = tiles[name];
      if (!t) continue;
      if (!e.tiles.includes(name)) e.tiles.push(name);
      if (t.coverage > e.coverage) {
        e.coverage = t.coverage;
        e.brightness = t.brightness;
      }
      // How deep the deck is: a row carrying both a bottom and a top is two layers of sky.
      if (which === 'cloudTop') e.decks = Math.max(e.decks, row.cloudBottom ? 2 : 1);
      else e.decks = Math.max(e.decks, 1);
    }
    byLevel.set(level, e);
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level);
}

/** Measure one converted world. Answers null when it has no sky pack to read. */
export function measureWorld(root, pack) {
  const dir = path.join(root, pack);
  const skyFile = path.join(dir, 'sky.json');
  if (!existsSync(skyFile)) return null;
  const sky = JSON.parse(readFileSync(skyFile, 'utf8'));
  const blocks = sky.blocks ?? [];
  const tiles = {};
  const named = new Set();
  for (const row of blocks) for (const w of ['cloudBottom', 'cloudTop']) if (row[w]?.file) named.add(row[w].file);
  for (const rel of named) {
    const file = path.join(dir, rel);
    if (!existsSync(file)) continue;
    const t = measureTile(readFileSync(file));
    if (t) tiles[path.basename(rel)] = t;
  }
  // `pictures` after everything the file held before, so the fields of before stand in their places and the September
  // loader, which takes `format` 1 alone, reads the file as it always did.
  return { format: CLOUDS_FORMAT, planet: sky.planet ?? pack, tiles, levels: gatherLevels(blocks, tiles), pictures: CLOUDS_PICTURES };
}

/** Measure every converted world under `root` and write each one's `clouds.json`. */
export function bakeClouds(root, packs, log = () => {}) {
  const done = [];
  const skipped = [];
  for (const pack of packs) {
    const out = measureWorld(root, pack);
    if (!out) {
      skipped.push(pack);
      continue;
    }
    writeFileSync(path.join(root, pack, 'clouds.json'), JSON.stringify(out, null, 1));
    const worst = out.levels.reduce((m, l) => (l.coverage > m.coverage ? l : m), { coverage: 0, brightness: 1 });
    done.push({ pack, tiles: Object.keys(out.tiles).length, levels: out.levels.length, coverage: worst.coverage, brightness: worst.brightness });
    log(`clouds: ${pack.padEnd(24)} ${Object.keys(out.tiles).length} tiles, ${out.levels.length} levels, up to ${(worst.coverage * 100).toFixed(0)}% covered at brightness ${worst.brightness.toFixed(2)}`);
  }
  return { done, skipped };
}
