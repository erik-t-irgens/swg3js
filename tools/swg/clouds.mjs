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
  for (let i = 0; i < n; i++) {
    const a = img.rgba[i * 4 + 3] / 255;
    alpha += a;
    if (a > 0.78) solid++;
    const lum = (img.rgba[i * 4] * 0.299 + img.rgba[i * 4 + 1] * 0.587 + img.rgba[i * 4 + 2] * 0.114) / 255;
    lumWeighted += lum * a;
    weight += a;
  }
  return {
    width: img.width,
    height: img.height,
    /** Mean alpha: the share of sky this sheet covers. */
    coverage: round(alpha / n),
    /** The share of it that is opaque, which is what tells a deck from a haze. */
    solid: round(solid / n),
    /** Mean brightness of what is actually cloud, alpha-weighted. */
    brightness: round(weight > 0 ? lumWeighted / weight : 0),
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
  return { format: CLOUDS_FORMAT, planet: sky.planet ?? pack, tiles, levels: gatherLevels(blocks, tiles) };
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
