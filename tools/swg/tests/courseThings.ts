// What stands near a race course on a converted world, read out of the pack in node, in the raw frame the track file
// is written in: the corridor check's things (`corridorHits` in src/race/trackFile.ts) without a browser. Every placed
// object at its own model's size (the snapshot's layout and the manifest's boxes, a particle effect and a thing with no
// box in the way of nothing, as `LayoutStreamer.objectsNear` has it), every collidable planting the terrain would plant
// near the course (the game's own rule per 16 m tile, as `floraBlock.ts` plants it, with the client's own collision
// shapes), every site the world's own data lays a lair, a herd or a camp on (`gridSites`), and every post a person
// stands at out of doors. The plants the course's `clear` keeps off are counted all the same: a course is chosen where
// nothing would stand even without it.
//
// It reads the converted packs only and opens no archive. `raceTrack.test.ts` holds the committed TEST course to it
// whenever the packs are present. Not a test itself.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachBitmap, bitmapFiles, parseLayerFile, parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { hashFloat, hashTuple } from '../../../src/swg/terrain/flora.ts';
import { RandomGenerator } from '../../../src/swg/terrain/fractal.ts';
import { floraColliders, mergeFloraCollision } from '../../../src/world/floraCollision.ts';
import { gridSites, type GroupEntry, type SpawnArea } from '../../../src/world/mobiles/lairs.ts';
import type { FloraChunkData } from '../../../src/world/floraBatch.ts';
import type { CourseLeg, CourseThing } from '../../../src/race/trackFile.ts';
import { legDistance } from '../../../src/race/trackFile.ts';
import { yawOf } from './terrainAudit.ts';

const TILE = 16;

interface Bounds {
  min: number[];
  max: number[];
}

/** A pack's terrain, sampler and flora, read once: what `plantingsNear` plants from. */
export interface PackGround {
  sampler: TerrainSampler;
  template: ReturnType<typeof parseTerrainTemplate>;
  models: Map<string, { radius: number; height: number; def: { appearance?: string; collision?: unknown } }>;
}

/** A world's terrain read out of its pack, with its buildings' layers laid on and its flora's own collision shapes. */
export function packGround(dir: string): PackGround | null {
  const layoutFile = join(dir, 'layout.json');
  if (!existsSync(layoutFile)) return null;
  const layout = JSON.parse(readFileSync(layoutFile, 'utf8'));
  if (!layout.terrain || !existsSync(join(dir, layout.terrain))) return null;
  const template = parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, layout.terrain))));
  for (const b of bitmapFiles(template)) {
    const file = join(dir, b.file);
    if (existsSync(file)) attachBitmap(template, b.familyId, new Uint8Array(readFileSync(file)));
  }
  const sampler = new TerrainSampler(template);
  for (const o of layout.objects as { contained?: boolean; layer?: string; x: number; z: number; q: number[] }[]) {
    if (o.contained || !o.layer || !existsSync(join(dir, o.layer))) continue;
    const layer = parseLayerFile(new Uint8Array(readFileSync(join(dir, o.layer))), template.generator);
    if (layer) sampler.addBuildingLayer(layer, o.x, o.z, yawOf(o.q));
  }
  const manifest = existsSync(join(dir, 'manifest.json')) ? JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) : { categories: {} };
  const defs = (manifest.categories?.flora ?? []) as { appearance?: string; bounds: Bounds; collision?: unknown }[];
  const file = existsSync(join(dir, 'flora-collision.json')) ? JSON.parse(readFileSync(join(dir, 'flora-collision.json'), 'utf8')) : null;
  mergeFloraCollision(defs as never, file);
  const models = new Map<string, { radius: number; height: number; def: { appearance?: string; collision?: unknown } }>();
  for (const d of defs) {
    if (!d.appearance) continue;
    const { min, max } = d.bounds;
    models.set(d.appearance.replace(/\\/g, '/').toLowerCase(), { radius: Math.max(Math.abs(max[0] - min[0]), Math.abs(max[2] - min[2])) / 2, height: Math.abs(max[1] - min[1]), def: d });
  }
  return { sampler, template, models };
}

/** The ground's height at a raw-frame point (the terrain's own frame). */
export function groundAt(g: PackGround, x: number, z: number): number {
  return g.sampler.heightAt(x, z);
}

/**
 * The collidable plantings within `reach` of a course's legs, each as a circle on the ground: the planting's place
 * and the reach of the client's own collision shape round it (nothing where the client walked through it). The 16 m
 * tiles' rule is the game's (`floraBlock.ts`).
 */
export function plantingsNear(g: PackGround, legs: readonly CourseLeg[], reach: number): CourseThing[] {
  const out: CourseThing[] = [];
  const t = g.template;
  const baked = !t.flora.legacyMap && t.flora.collidableMap ? t.flora.collidableMap : null;
  const group = t.generator.floraGroup;
  const border = t.flora.collidable.tileBorder;
  const across = Math.floor(t.mapWidthInMeters / TILE);
  const centre = Math.floor(across / 2);
  const seen = new Set<number>();
  for (const l of legs) {
    const x0 = Math.min(l.ax, l.bx) - l.half - reach;
    const x1 = Math.max(l.ax, l.bx) + l.half + reach;
    const z0 = Math.min(l.az, l.bz) - l.half - reach;
    const z1 = Math.max(l.az, l.bz) + l.half + reach;
    for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
        const keyX = tx + centre;
        const keyZ = tz + centre;
        if (keyX < 0 || keyZ < 0 || keyX >= across || keyZ >= across) continue;
        const id = keyZ * across + keyX;
        if (seen.has(id)) continue;
        // Only tiles whose middle lies near the leg (with the reach and the tile's own half-diagonal).
        if (legDistance(l, (tx + 0.5) * TILE, (tz + 0.5) * TILE) > l.half + reach + TILE) continue;
        seen.add(id);
        const random = new RandomGenerator((keyZ * across + keyX) >>> 0);
        const x = tx * TILE + border + random.randomReal() * (TILE - 2 * border);
        const z = tz * TILE + border + random.randomReal() * (TILE - 2 * border);
        if (g.sampler.excludedAt(x, z)) continue;
        let family: number;
        let choice: number;
        if (baked) {
          family = baked.getValue(keyX, keyZ);
          choice = hashFloat(hashTuple(Math.floor(x), Math.floor(z)));
        } else {
          const f = g.sampler.floraAt(x, z, true);
          family = f.family;
          choice = f.choice;
        }
        if (!family) continue;
        const child = group.createFlora(family, choice);
        if (!child) continue;
        const yaw = random.randomReal() * Math.PI * 2;
        const scale = child.shouldScale ? child.minScale + random.randomReal() * (child.maxScale - child.minScale) : 1;
        const model = g.models.get(child.appearance.replace(/\\/g, '/').toLowerCase());
        if (!model) continue;
        const m = new Float32Array(16);
        const a = -yaw;
        m[0] = scale * Math.cos(a);
        m[2] = -scale * Math.sin(a);
        m[5] = scale;
        m[8] = scale * Math.sin(a);
        m[10] = scale * Math.cos(a);
        m[15] = 1;
        const data: FloraChunkData = { n: 1, models: [model as never], mats: m, x: new Float32Array([0]), y: new Float32Array([0]), z: new Float32Array([0]), scale: new Float32Array([scale]), collidable: new Uint8Array([1]) };
        let r = 0;
        for (const c of floraColliders(data, [])) r = Math.max(r, Math.hypot(c.x, c.z) + c.r);
        if (r > 0) out.push({ x, z, r, what: `a planting (${child.appearance})` });
      }
    }
  }
  return out;
}

/** Every placed object out of doors at its own model's size, in the raw frame (`LayoutStreamer.objectsNear`'s rule). */
export function placedThings(dir: string): CourseThing[] {
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { objects: { model?: string; x: number; z: number; contained?: boolean }[] };
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { categories: Record<string, { id: string; bounds?: Bounds; particle?: unknown }[]> };
  const defs = new Map<string, { bounds?: Bounds; particle?: unknown }>();
  for (const list of Object.values(manifest.categories ?? {})) for (const d of list) if (!defs.has(d.id)) defs.set(d.id, d);
  const out: CourseThing[] = [];
  for (const o of layout.objects) {
    if (o.contained || !o.model) continue;
    const d = defs.get(o.model);
    if (!d || d.particle || !d.bounds) continue;
    const r = Math.max(Math.abs(d.bounds.max[0] - d.bounds.min[0]), Math.abs(d.bounds.max[2] - d.bounds.min[2])) / 2;
    if (!(r > 0)) continue;
    out.push({ x: o.x, z: o.z, r, what: `placed ${o.model}` });
  }
  return out;
}

/** Every site the world's own data lays a lair, a herd or a camp on, and every post a person stands at out of doors, in the raw frame. */
export function spawnThings(dir: string, packs: string): CourseThing[] {
  const file = join(dir, 'spawns.json');
  const man = join(packs, 'spawns', 'manifest.json');
  if (!existsSync(file)) return [];
  const pack = JSON.parse(readFileSync(file, 'utf8')) as { planet: string; areas?: SpawnArea[]; noSpawn?: SpawnArea[]; statics?: { x: number; z: number; cell?: number; who?: string }[] };
  const out: CourseThing[] = [];
  if (existsSync(man) && Array.isArray(pack.areas)) {
    const manifest = JSON.parse(readFileSync(man, 'utf8')) as { groups: Record<string, GroupEntry[]> };
    for (const s of gridSites(pack.planet, pack.areas, pack.noSpawn ?? [], manifest.groups ?? {})) out.push({ x: s.x, z: s.z, r: Math.max(5, s.size / 2), what: `a lair, herd or camp (${s.lair})` });
  }
  for (const r of pack.statics ?? []) if (!r.cell && Number.isFinite(r.x) && Number.isFinite(r.z)) out.push({ x: r.x, z: r.z, r: 1, what: `a post (${r.who ?? 'someone'})` });
  return out;
}
