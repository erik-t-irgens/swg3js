// How solid a world's trees and rocks are, measured rather than argued about.
//
// Every collidable planting used to stand on one upright cylinder guessed from its model's box, and a
// wide tree's box is its canopy, so a forest came out solid. The client's own collision shapes
// (`tools/swg/extent.mjs`, written by the `floracollision` pass) are a trunk, a few cylinders round a
// rock, or nothing. This plants a world's collidable flora the way the game plants it, on an even
// draw of its 16 m tiles, and puts both rules over the very same plantings through the game's own
// arithmetic (`floraColliders` in src/world/floraCollision.ts):
//
//   blocking   how many plantings stand on anything at all
//   tile share the share of a planted 16 m tile a walker cannot stand in, between 0.1 and 1.8 m over
//              the planting's foot, capped at the tile (the reading the finding measured with)
//   mean area  the same uncapped, in square metres, which is where a 150 m wroshyr cylinder shows
//
// It reads the converted packs only (terrain.trn, its bitmaps and building layers, the manifest and
// flora-collision.json) and opens no archive. A world with no flora-collision.json measures the guess
// twice, which is what "before the pass" is.
//
// Run:  node tools/swg/tests/floraBlock.ts <assets-dir> [planet ...] [--samples=200000] [--seed=1]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachBitmap, bitmapFiles, parseLayerFile, parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { FastRandomGenerator, hashFloat, hashTuple } from '../../../src/swg/terrain/flora.ts';
import { RandomGenerator } from '../../../src/swg/terrain/fractal.ts';
import { FLORA_COLLISION, floraColliders, mergeFloraCollision, type ColliderPart } from '../../../src/world/floraCollision.ts';
import type { FloraChunkData } from '../../../src/world/floraBatch.ts';
import type { Collider } from '../../../src/world/props.ts';
import { yawOf } from './terrainAudit.ts';

/** The band a walker's body fills, metres over the planting's foot: ours, for the measurement only. */
export const WALK_BAND = { low: 0.1, high: 1.8 };
const TILE = 16;

interface Model {
  radius: number;
  height: number;
  def: { appearance?: string; collision?: unknown };
}

/** Whether a point (x, z) lies inside a mesh part's slice at height y: crossings of the slice's edges. */
function insideSlice(v: Float32Array, idx: Uint32Array, y: number, x: number, z: number): boolean {
  let inside = false;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const pts: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e] * 3;
      const b = idx[t + ((e + 1) % 3)] * 3;
      const ya = v[a + 1];
      const yb = v[b + 1];
      if ((ya <= y && yb > y) || (yb <= y && ya > y)) {
        const k = (y - ya) / (yb - ya);
        pts.push(v[a] + (v[b] - v[a]) * k, v[a + 2] + (v[b + 2] - v[a + 2]) * k);
      }
    }
    if (pts.length < 4) continue;
    const [x1, z1, x2, z2] = pts;
    if ((z1 > z) !== (z2 > z) && x < x1 + ((z - z1) * (x2 - x1)) / (z2 - z1)) inside = !inside;
  }
  return inside;
}

/** Whether a part blocks a walker at (x, z) anywhere in the band [lo, hi]. */
export function partBlocks(p: ColliderPart, x: number, z: number, lo: number, hi: number): boolean {
  if (p.kind === 'cyl') return p.y + p.hy >= lo && p.y - p.hy <= hi && Math.hypot(x - p.x, z - p.z) <= p.r;
  if (p.kind === 'ball') {
    const d = p.y < lo ? lo - p.y : p.y > hi ? p.y - hi : 0;
    if (d >= p.r) return false;
    return Math.hypot(x - p.x, z - p.z) <= Math.sqrt(p.r * p.r - d * d);
  }
  if (p.kind === 'box') {
    if (p.y + p.hy < lo || p.y - p.hy > hi) return false;
    // Into the box's own frame: undo its turn about Y (the quaternion's y and w).
    const ang = 2 * Math.atan2(p.qy, p.qw);
    const dx = x - p.x;
    const dz = z - p.z;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    return Math.abs(lx) <= p.hx && Math.abs(lz) <= p.hz;
  }
  if (p.kind === 'mesh' && p.verts && p.idx) {
    for (const y of [lo, (lo + hi) / 2, hi]) if (insideSlice(p.verts, p.idx, y, x, z)) return true;
  }
  return false;
}

/** The ground a collider takes from a walker, square metres, rastered at `cell` within its reach. */
export function blockedArea(c: Collider, footY: number, cell = 0.1): number {
  const lo = footY + WALK_BAND.low;
  const hi = footY + WALK_BAND.high;
  if (!c.parts) return c.top >= lo ? Math.PI * c.r * c.r : 0;
  const reach = Math.max(0.05, c.r);
  const step = Math.max(cell, reach / 120);
  let n = 0;
  for (let gz = -reach; gz <= reach; gz += step) {
    for (let gx = -reach; gx <= reach; gx += step) {
      const x = c.x + gx;
      const z = c.z + gz;
      for (const p of c.parts) {
        if (partBlocks(p, x, z, lo, hi)) {
          n++;
          break;
        }
      }
    }
  }
  return n * step * step;
}

/** One planting at the origin as the chunk data the game builds colliders from. */
function oneAt(model: Model, yaw: number, scale: number): FloraChunkData {
  const m = new Float32Array(16);
  // compose((0, 0, 0), about Y by -yaw, scale), column-major as three writes it.
  const t = -yaw;
  m[0] = scale * Math.cos(t);
  m[2] = -scale * Math.sin(t);
  m[5] = scale;
  m[8] = scale * Math.sin(t);
  m[10] = scale * Math.cos(t);
  m[15] = 1;
  return { n: 1, models: [model as never], mats: m, x: new Float32Array([0]), y: new Float32Array([0]), z: new Float32Array([0]), scale: new Float32Array([scale]), collidable: new Uint8Array([1]) };
}

interface Tally {
  plantings: number;
  blocking: number;
  share: number;
  area: number;
}

function measureWorld(dir: string, samples: number, seed: number): { name: string; tiles: number; withFile: boolean; legacy: boolean; guess: Tally; client: Tally } | null {
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
  if (!layout.terrain || !existsSync(join(dir, layout.terrain)) || !existsSync(join(dir, 'manifest.json'))) return null;
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
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const defs = (manifest.categories?.flora ?? []) as { appearance?: string; bounds: { min: number[]; max: number[] }; collision?: unknown }[];
  if (!defs.length) return null;
  const file = existsSync(join(dir, 'flora-collision.json')) ? JSON.parse(readFileSync(join(dir, 'flora-collision.json'), 'utf8')) : null;
  mergeFloraCollision(defs as never, file);
  const models = new Map<string, Model>();
  for (const d of defs) {
    if (!d.appearance) continue;
    const { min, max } = d.bounds;
    models.set(d.appearance.replace(/\\/g, '/').toLowerCase(), { radius: Math.max(max[0] - min[0], max[2] - min[2]) / 2, height: max[1] - Math.min(0, min[1]), def: d });
  }
  const baked = !template.flora.legacyMap && template.flora.collidableMap ? template.flora.collidableMap : null;
  const group = template.generator.floraGroup;
  const border = template.flora.collidable.tileBorder;
  const across = Math.floor(template.mapWidthInMeters / TILE);
  const centre = Math.floor(across / 2);
  const rng = new FastRandomGenerator(seed);
  const guess: Tally = { plantings: 0, blocking: 0, share: 0, area: 0 };
  const client: Tally = { plantings: 0, blocking: 0, share: 0, area: 0 };
  const memo = new Map<string, [number, number]>();
  const rule = FLORA_COLLISION.rule;
  for (let s = 0; s < samples; s++) {
    const keyX = Math.floor(rng.randomFloat() * across) % across;
    const keyZ = Math.floor(rng.randomFloat() * across) % across;
    const tx = keyX - centre;
    const tz = keyZ - centre;
    const random = new RandomGenerator((keyZ * across + keyX) >>> 0);
    const x = tx * TILE + border + random.randomReal() * (TILE - 2 * border);
    const z = tz * TILE + border + random.randomReal() * (TILE - 2 * border);
    if (sampler.excludedAt(x, z)) continue;
    let family: number;
    let choice: number;
    if (baked) {
      family = baked.getValue(keyX, keyZ);
      choice = hashFloat(hashTuple(Math.floor(x), Math.floor(z)));
    } else {
      const f = sampler.floraAt(x, z, true);
      family = f.family;
      choice = f.choice;
    }
    if (!family) continue;
    const child = group.createFlora(family, choice);
    if (!child) continue;
    const yaw = random.randomReal() * Math.PI * 2;
    const scale = child.shouldScale ? child.minScale + random.randomReal() * (child.maxScale - child.minScale) : 1;
    const key = child.appearance.replace(/\\/g, '/').toLowerCase();
    const model = models.get(key);
    if (!model) continue;
    // A planting's area does not hang on where it stands, only on what and how big; its turn moves
    // nothing but a box's, whose area it keeps. So it is worked out once per model and scale step.
    const mk = `${key}|${scale.toFixed(2)}`;
    let both = memo.get(mk);
    if (!both) {
      const data = oneAt(model, yaw, scale);
      FLORA_COLLISION.rule = 'guess';
      const g = floraColliders(data, []);
      FLORA_COLLISION.rule = 'client';
      const c = floraColliders(data, []);
      FLORA_COLLISION.rule = rule;
      const area = (list: Collider[]) => list.reduce((a, col) => a + blockedArea(col, 0), 0);
      both = [area(g), area(c)];
      memo.set(mk, both);
    }
    for (const [t, a] of [[guess, both[0]], [client, both[1]]] as const) {
      t.plantings++;
      if (a > 0) t.blocking++;
      t.share += Math.min(a, TILE * TILE) / (TILE * TILE);
      t.area += a;
    }
  }
  for (const t of [guess, client]) {
    if (!t.plantings) continue;
    t.share /= t.plantings;
    t.area /= t.plantings;
  }
  return { name: layout.planet ?? dir, tiles: samples, withFile: !!file, legacy: !baked, guess, client };
}

function main(): void {
  const argv = process.argv.slice(2);
  const flags = new Map(argv.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? '']));
  const pos = argv.filter((a) => !a.startsWith('--'));
  const root = pos[0] ?? 'assets-private';
  if (!existsSync(root)) {
    console.error('usage: node tools/swg/tests/floraBlock.ts <assets-dir> [planet ...] [--samples=200000] [--seed=1]');
    process.exit(1);
  }
  const samples = Number(flags.get('samples') ?? 200000);
  const seed = Number(flags.get('seed') ?? 1);
  const names = (pos.length > 1 ? pos.slice(1) : readdirSync(root)).filter((n) => existsSync(join(root, n, 'layout.json')) && existsSync(join(root, n, 'terrain.trn')));
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  console.log(`flora blocking over ${names.length} worlds, ${samples} tiles drawn a world (seed ${seed}); band ${WALK_BAND.low}-${WALK_BAND.high} m over each planting's foot`);
  console.log(`${'world'.padEnd(26)} ${'plantings'.padStart(9)}  ${'blocking: guess'.padStart(15)} ${'client'.padStart(7)}   ${'tile share: guess'.padStart(17)} ${'client'.padStart(7)}   ${'mean m2: guess'.padStart(14)} ${'client'.padStart(7)}`);
  for (const n of names) {
    const t0 = Date.now();
    const r = measureWorld(join(root, n), samples, seed);
    if (!r) continue;
    const g = r.guess;
    const c = r.client;
    console.log(`${(n + (r.withFile ? '' : ' (no file)')).padEnd(26)} ${String(g.plantings).padStart(9)}  ${pct(g.blocking / Math.max(1, g.plantings)).padStart(15)} ${pct(c.blocking / Math.max(1, c.plantings)).padStart(7)}   ${pct(g.share).padStart(17)} ${pct(c.share).padStart(7)}   ${g.area.toFixed(1).padStart(14)} ${c.area.toFixed(1).padStart(7)}   ${((Date.now() - t0) / 1000).toFixed(1)} s${r.legacy ? ' (generated flora map)' : ''}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
