// What the terrain generator's tests share (terrainSnap.test.ts, colorMap.test.ts): a converted world's
// own terrain file read off disk with the bitmaps the pack carries, the colour ramps it names read out
// of the client's archives (not out of the pack's own file, which groundTextures.test.ts holds to these), the blocks sampled the
// way the research that set this pass's figures sampled them, and the client's own baked flora map read
// at its own tile points. Not a test itself.
//
// The packs come from SWG3JS_PACKS, else assets-private; the archives from SWG in the environment or the
// .env beside package.json. A machine with neither is told so by the tests and checks nothing here.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RandomGenerator } from '../../../src/swg/terrain/fractal.ts';
import { attachBitmap, attachRamp, bitmapFiles, parseTerrainTemplate, rampFromImage, rampNames, TerrainSampler, type TerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { decodeTga } from '../tga.mjs';
import { PACKS, type Vfs } from './materialsHarness.ts';
import { floraTilePoint } from './terrainAudit.ts';

export { PACKS };

/** Every world under the packs folder that carries a terrain file, sorted. */
export function groundWorlds(): string[] {
  if (!existsSync(PACKS)) return [];
  return readdirSync(PACKS)
    .filter((w) => existsSync(join(PACKS, w, 'terrain.trn')))
    .sort();
}

export interface LoadedWorld {
  name: string;
  template: TerrainTemplate;
  sampler: TerrainSampler;
  /** The ramps the colour affectors name, and which of them the archives gave. */
  ramps: { named: string[]; loaded: number; missing: string[]; tall: string[] };
}

/** A ramp as the archives hold it (a TGA), decoded and cut to its first row as the engine reads it; null where it is not there. */
export function rampFromArchives(vfs: Vfs, key: string): { ramp: { width: number; rgb: Uint8Array }; height: number } | null {
  if (!vfs.has(key)) return null;
  const img = decodeTga(vfs.read(key)) as { width: number; height: number; rgba: Uint8Array };
  return { ramp: rampFromImage(img.width, img.rgba), height: img.height };
}

/** A converted world's terrain as the game builds it (no building layers: the research measured the bare file), with the archives' ramps when `vfs` is given. */
export function loadWorld(name: string, vfs: Vfs | null = null): LoadedWorld | null {
  const dir = join(PACKS, name);
  if (!existsSync(join(dir, 'terrain.trn'))) return null;
  const template = parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, 'terrain.trn'))));
  for (const b of bitmapFiles(template)) {
    const file = join(dir, b.file);
    if (existsSync(file)) attachBitmap(template, b.familyId, new Uint8Array(readFileSync(file)));
  }
  const named = rampNames(template);
  const missing: string[] = [];
  const tall: string[] = [];
  let loaded = 0;
  if (vfs) {
    for (const key of named) {
      const r = rampFromArchives(vfs, key);
      if (!r) {
        missing.push(key);
        continue;
      }
      if (r.height !== 1) tall.push(`${key} (${r.height} rows)`);
      if (attachRamp(template, key, r.ramp)) loaded++;
    }
  }
  return { name, template, sampler: new TerrainSampler(template), ramps: { named, loaded, missing, tall } };
}

/** The research's sampling: `count` blocks spread over the inner 80% of the map from one seed. */
export function sampleBlocks(template: TerrainTemplate, count: number, seed = 12345): { bx: number; bz: number }[] {
  const r = new RandomGenerator(seed);
  const half = template.mapWidthInMeters / 2;
  const out: { bx: number; bz: number }[] = [];
  for (let i = 0; i < count; i++) {
    const x = (r.randomReal() * 1.6 - 0.8) * half;
    const z = (r.randomReal() * 1.6 - 0.8) * half;
    out.push({ bx: Math.floor(x / 64), bz: Math.floor(z / 64) });
  }
  return out;
}

export interface BakedFlora {
  /** Tiles in the sampled blocks, and how many of them name the same collidable family as the client's map (nothing and nothing included). */
  tiles: number;
  same: number;
  /** Tiles the client's map plants, how many of those ours plants too, and how many of those with the client's family. */
  baked: number;
  ours: number;
  agree: number;
  /** |our height - the client's| at every planted tile's own point. */
  heightErrors: number[];
}

/**
 * Our collidable flora against the client's baked map (PIMP) and our ground against its baked heights
 * (PFPM), at each 16 m tile's own point, over the 4 x 4 tiles of every sampled block. The sampler's
 * cache is emptied after each block, so a run over hundreds of blocks holds a handful.
 */
export function bakedFlora(world: LoadedWorld, blocks: { bx: number; bz: number }[]): BakedFlora | null {
  const t = world.template;
  const map = t.flora.collidableMap;
  const heights = t.flora.collidableHeightMap;
  if (!map) return null;
  const tile = 16;
  const across = Math.floor(t.mapWidthInMeters / tile);
  const centre = Math.floor(across / 2);
  const border = t.flora.collidable.tileBorder;
  const out: BakedFlora = { tiles: 0, same: 0, baked: 0, ours: 0, agree: 0, heightErrors: [] };
  const s = world.sampler;
  s.invalidateAll();
  for (const b of blocks) {
    for (let tz = b.bz * 4; tz < b.bz * 4 + 4; tz++) {
      for (let tx = b.bx * 4; tx < b.bx * 4 + 4; tx++) {
        const kx = tx + centre;
        const kz = tz + centre;
        if (kx < 0 || kz < 0 || kx >= across || kz >= across) continue;
        const want = map.getValue(kx, kz);
        const p = floraTilePoint(tx, tz, across, border, tile);
        const got = s.floraAt(p.x, p.z, true).family;
        out.tiles++;
        if (got === want) out.same++;
        if (!want) continue;
        out.baked++;
        if (heights) out.heightErrors.push(Math.abs(s.heightAt(p.x, p.z) - heights.getValue(kx, kz)));
        if (!got) continue;
        out.ours++;
        if (got === want) out.agree++;
      }
    }
    s.invalidateAll();
  }
  return out;
}

/** Rec. 709 luminance of three bytes, 0..1. */
export const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
