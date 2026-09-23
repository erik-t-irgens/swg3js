// What the flora exclusion around placed objects costs, measured rather than argued about.
//
// The game keeps procedural flora off a disc around every placed object: the snapshot's own
// radius plus two metres (src/world/layoutStream.ts). The original client kept it off whatever
// the object template's own clearFloraRadius said. This script measures the difference on every
// converted planet and builds nothing: how many templates carry that radius at all, how the two
// rules compare, how much ground stops being excluded, and -- by planting the flora the way the
// game plants it, on a sample of the map -- roughly how many plants that is.
//
// Run:  node tools/swg/tests/floraClearance.ts <swg-dir> <assets-dir> [planet ...] --retail-only
//       [--blocks=2000] [--seed=1] [--cell=4] [--census]
//
// --census adds a pass over every object template in the archives, counting what each one says
// about clearFloraRadius on its own account. It is the only way to make a claim about "the
// archives" rather than about the templates one planet's layout happens to name, and it is
// opt-in because it reads every template there is.
//
// It needs the archives because clearFloraRadius is not in any pack; everything else comes off
// the converted pack. The arithmetic in here is pinned by tools/swg/tests/terrainAudit.test.ts.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachBitmap, bitmapFiles, parseLayerFile, parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';
import { FastRandomGenerator, hashFloat, hashTuple } from '../../../src/swg/terrain/flora.ts';
import { RandomGenerator } from '../../../src/swg/terrain/fractal.ts';
import { yawOf } from './terrainAudit.ts';

/** Ours, and only the sampling: none of it changes what is measured, only how closely. */
export const CLEARANCE = {
  /** How many 64 m blocks of the planet to plant, drawn evenly over the whole map. */
  blocks: 2000,
  /** The raster the excluded area is measured on, in metres. */
  cell: 4,
  /** The draw is seeded so two runs of the same pack give the same figure. */
  seed: 1,
  /** How many templates to name as the biggest excluders. */
  top: 8,
  /** Collidable flora tiles are 16 m in the engine whatever the template says (src/world/flora.ts). */
  collidableTile: 16,
  /** The game files an exclusion into every terrain chunk cell it touches; CHUNK_SIZE in src/world/terrain.ts. */
  chunk: 64,
};

/** How many entries the game's exclusion index takes: one per chunk cell each disc touches. */
export function indexEntries(discs: { x: number; z: number; r: number }[], chunk = CLEARANCE.chunk): number {
  let n = 0;
  for (const d of discs) {
    if (!(d.r > 0)) continue;
    const wide = Math.floor((d.x + d.r) / chunk) - Math.floor((d.x - d.r) / chunk) + 1;
    const tall = Math.floor((d.z + d.r) / chunk) - Math.floor((d.z - d.r) / chunk) + 1;
    n += wide * tall;
  }
  return n;
}

/**
 * A template parameter that is a float: int8 data type (1 = SINGLE), the delta byte (' ', '+',
 * '-' or '%'), then the float -- the same shape `intParam` reads an integer out of. A parameter a
 * template merely declares carries data type 0 and two bytes, and the chain walk goes on past it.
 */
export function floatParam(buf: Buffer | null | undefined): number | null {
  if (!buf || buf.length < 6 || buf[0] !== 1) return null;
  return buf.readFloatLE(2);
}

/** The area of the ring between two radii, never negative. */
export function ringArea(outer: number, inner: number): number {
  return Math.PI * Math.max(0, outer * outer - inner * inner);
}

/** A seeded draw of `want` distinct indices below `n`, ascending. */
export function drawIndices(n: number, want: number, seed: number): number[] {
  if (want >= n) return Array.from({ length: n }, (_, i) => i);
  const rng = new FastRandomGenerator(seed);
  const picked = new Set<number>();
  let guard = 0;
  while (picked.size < want && guard++ < want * 40) picked.add(Math.floor(rng.randomFloat() * n) % n);
  return [...picked].sort((a, b) => a - b);
}

/** Discs on a plane, asked "does any of you cover this point" a great many times. */
export class DiscIndex {
  private readonly cell: number;
  private readonly grid = new Map<string, { x: number; z: number; r2: number }[]>();
  /** A disc wider than a cell would touch too many cells to stamp, so the widest go in a list of their own. */
  private readonly wide: { x: number; z: number; r2: number }[] = [];
  private readonly wideLimit: number;

  constructor(cell = 64, wideLimit = 512) {
    this.cell = cell;
    this.wideLimit = wideLimit;
  }

  add(x: number, z: number, r: number): void {
    if (!(r > 0)) return;
    const d = { x, z, r2: r * r };
    if (r > this.wideLimit) {
      this.wide.push(d);
      return;
    }
    const c = this.cell;
    for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
      for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
        const key = `${i},${j}`;
        const list = this.grid.get(key);
        if (list) list.push(d);
        else this.grid.set(key, [d]);
      }
    }
  }

  covers(x: number, z: number): boolean {
    for (const d of this.wide) if ((x - d.x) * (x - d.x) + (z - d.z) * (z - d.z) <= d.r2) return true;
    const list = this.grid.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    if (!list) return false;
    for (const d of list) if ((x - d.x) * (x - d.x) + (z - d.z) * (z - d.z) <= d.r2) return true;
    return false;
  }
}

/** The ground a set of discs excludes, in square metres, measured on a raster and clipped to the map. */
export function excludedArea(discs: { x: number; z: number; r: number }[], mapWidth: number, cell: number): number {
  const n = Math.max(1, Math.round(mapWidth / cell));
  const half = mapWidth / 2;
  const mask = new Uint8Array(n * n);
  for (const d of discs) {
    if (!(d.r > 0)) continue;
    const i0 = Math.max(0, Math.floor((d.x - d.r + half) / cell));
    const i1 = Math.min(n - 1, Math.floor((d.x + d.r + half) / cell));
    const j0 = Math.max(0, Math.floor((d.z - d.r + half) / cell));
    const j1 = Math.min(n - 1, Math.floor((d.z + d.r + half) / cell));
    const r2 = d.r * d.r;
    for (let j = j0; j <= j1; j++) {
      const cz = -half + (j + 0.5) * cell;
      const dz = cz - d.z;
      const row = j * n;
      for (let i = i0; i <= i1; i++) {
        if (mask[row + i]) continue;
        const cx = -half + (i + 0.5) * cell;
        const dx = cx - d.x;
        if (dx * dx + dz * dz <= r2) mask[row + i] = 1;
      }
    }
  }
  let on = 0;
  for (let k = 0; k < mask.length; k++) on += mask[k];
  return on * cell * cell;
}

interface LayoutObject {
  template: string;
  model: string;
  x: number;
  y: number;
  z: number;
  q: number[];
  radius: number;
  contained?: boolean;
  layer?: string;
}

/**
 * A model's real footprint from the pack's own bounds: how far its box reaches from the object's
 * own origin, across. A pack converted before the BOX corners were read componentwise can have
 * min and max the other way round, so the extents are taken as absolute differences and never by
 * trusting which corner is which. Measured only -- nothing uses this but the report.
 */
export function footprintRadius(bounds: { min: number[]; max: number[] } | undefined | null): number {
  if (!bounds || !bounds.min || !bounds.max) return 0;
  const ex = Math.abs(bounds.max[0] - bounds.min[0]) / 2;
  const ez = Math.abs(bounds.max[2] - bounds.min[2]) / 2;
  const cx = (bounds.max[0] + bounds.min[0]) / 2;
  const cz = (bounds.max[2] + bounds.min[2]) / 2;
  const r = Math.hypot(cx, cz) + Math.hypot(ex, ez);
  return Number.isFinite(r) ? r : 0;
}

/** A flora candidate the game would plant: where it lands and whether the pack can draw it. */
interface Candidate {
  x: number;
  z: number;
  drawable: boolean;
}

/**
 * What one object template says about `clearFloraRadius` **itself**, before any inheritance:
 * 'absent' (the template has no such parameter at all), 'declared' (it has the parameter with
 * data type 0, which is the template saying "I leave this to my base"), or a number it sets.
 */
export type OwnClearFlora = 'absent' | 'declared' | number;

export function ownClearFlora(buf: Buffer | null | undefined): OwnClearFlora {
  if (!buf || buf.length < 1) return 'absent';
  if (buf[0] !== 1) return 'declared';
  return buf.length >= 6 ? buf.readFloatLE(2) : 'declared';
}

export interface ArchiveCensus {
  /** Every `object/**.iff` the mounted archives hold. */
  templates: number;
  /** How many could not be parsed as a template at all. */
  unreadable: number;
  /** How many carry the parameter in any form (declared or set). */
  declared: number;
  /** How many set it to a value of their own. */
  set: number;
  /** Of those, how many set it to zero, and how many to something. */
  zero: number;
  nonZero: number;
  /** Every distinct non-zero value a template sets itself, with how many templates set it. */
  values: Map<number, number>;
  /** The setters counted by the first two folders of their path, so "buildings only" is checkable. */
  byFolder: Map<string, number>;
}

/**
 * Walk every object template in the mounted archives and count what each one says about
 * `clearFloraRadius` on its own account. This is the only honest way to make a claim about "the
 * archives": resolving the field for the templates one planet's layout happens to name says
 * nothing about the other twenty-odd thousand, and it folds inheritance in, which hides which
 * template the value actually came from.
 */
export function censusArchive(
  vfs: { list: (f?: string) => string[]; read: (n: string) => Buffer },
  parseIff: (b: Buffer) => unknown,
  readTemplate: (r: unknown) => { params: Map<string, Buffer> },
  onProgress?: (done: number, total: number) => void,
): ArchiveCensus {
  // vfs.list matches anywhere in the path, so the prefix is anchored here: "templates under
  // object/" has to mean exactly that if it is going to be quoted as a fact about the archives.
  const files = vfs.list('object/').filter((f) => f.startsWith('object/') && f.endsWith('.iff'));
  const out: ArchiveCensus = { templates: files.length, unreadable: 0, declared: 0, set: 0, zero: 0, nonZero: 0, values: new Map(), byFolder: new Map() };
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let own: OwnClearFlora;
    try {
      own = ownClearFlora(readTemplate(parseIff(vfs.read(f))).params.get('clearFloraRadius'));
    } catch {
      out.unreadable++;
      continue;
    }
    if (own === 'absent') continue;
    out.declared++;
    if (own === 'declared') continue;
    out.set++;
    if (own === 0) out.zero++;
    else {
      out.nonZero++;
      out.values.set(own, (out.values.get(own) ?? 0) + 1);
      const folder = f.split('/').slice(0, 2).join('/');
      out.byFolder.set(folder, (out.byFolder.get(folder) ?? 0) + 1);
    }
    if (onProgress && i % 2000 === 0) onProgress(i, files.length);
  }
  return out;
}

/**
 * `@SWG` on the command line becomes the folder named in the .env beside package.json, the same
 * way the converter does it, so the command in the README can be copied as it stands.
 */
function expandEnv(a: string): string {
  const envFile = new URL('../../../.env', import.meta.url);
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      let value = m[2];
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
  // `--flag=@SWG` keeps its `--flag=`: the capture has to be put back, exactly as cli.mjs does it.
  return a.replace(/(^|=)@([A-Za-z_][A-Za-z0-9_]*)$/g, (whole, before, name) => {
    const value = process.env[name];
    return value === undefined ? whole : before + value;
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).map(expandEnv);
  const flags = new Map(argv.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? '']));
  const pos = argv.filter((a) => !a.startsWith('--'));
  const swgDir = pos[0];
  const root = pos[1] ?? 'assets-private';
  if (!swgDir || !existsSync(swgDir) || !existsSync(root)) {
    console.error('usage: node tools/swg/tests/floraClearance.ts <swg-dir> <assets-dir> [planet ...] --retail-only [--blocks=2000] [--seed=1] [--cell=4] [--census]');
    process.exit(1);
  }
  const wantBlocks = Number(flags.get('blocks') ?? CLEARANCE.blocks);
  const cell = Number(flags.get('cell') ?? CLEARANCE.cell);
  const seed = Number(flags.get('seed') ?? CLEARANCE.seed);
  const top = Number(flags.get('top') ?? CLEARANCE.top);

  // The converter's own readers, which are .mjs; this file is .ts only so it can run the
  // terrain sampler, so they are pulled in by URL rather than by a relative import.
  const here = new URL('.', import.meta.url);
  const { openVfs } = await import(new URL('../tre.mjs', here).href);
  const { isRetailByName } = await import(new URL('../manifest.mjs', here).href);
  const { resolveTemplateParam } = await import(new URL('../objtemplate.mjs', here).href);
  const { parseIff } = await import(new URL('../iff.mjs', here).href);
  const { readTemplate } = await import(new URL('../objtemplate.mjs', here).href);
  const retailOnly = flags.has('retail-only');
  const vfs = openVfs(swgDir, { filter: retailOnly ? (f: string) => isRetailByName(f, statSync(join(swgDir, f)).size) !== null : undefined });
  console.log(`mounted ${vfs.summary}${retailOnly ? ' (retail only)' : ''}`);

  // --- the archive-wide census: what every object template says about the field, before any
  //     planet is opened. It is opt-in because it reads every template in the archives.
  if (flags.has('census')) {
    const c0 = Date.now();
    const c = censusArchive(vfs, parseIff, readTemplate, (done, total) => process.stdout.write(`\r    ${done} of ${total} templates...`));
    process.stdout.write('\r');
    const vals = [...c.values.entries()].sort((a, b) => a[0] - b[0]);
    console.log('');
    console.log(`=== every object template in the mounted archives`);
    console.log(`    ${c.templates} templates under object/${c.unreadable ? `, ${c.unreadable} of them unreadable as templates` : ''}`);
    console.log(`    clearFloraRadius: ${c.declared} carry the parameter, ${c.set} set a value of their own (${c.zero} set it to zero, ${c.nonZero} set it to something); the rest inherit`);
    console.log(`    the ${c.nonZero} non-zero setters carry ${vals.length} distinct values: ${vals.map(([v, n]) => `${v}(x${n})`).join(' ')}`);
    console.log(`    smallest ${vals[0]?.[0] ?? 0} m, largest ${vals[vals.length - 1]?.[0] ?? 0} m, ${vals.filter(([v]) => !Number.isInteger(v)).length} of them not a whole number`);
    console.log(`    and by folder: ${[...c.byFolder.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(', ')}`);
    console.log(`    (${((Date.now() - c0) / 1000).toFixed(1)} s)`);
    console.log('');
  }

  const paramCache = new Map<string, number | null>();
  const clearFlora = new Map<string, number>();
  const radiusOf = (template: string): number => {
    const known = clearFlora.get(template);
    if (known !== undefined) return known;
    let v = 0;
    try {
      v = resolveTemplateParam(vfs, template, 'clearFloraRadius', floatParam, paramCache) ?? 0;
    } catch {
      v = 0;
    }
    if (!Number.isFinite(v) || v < 0) v = 0;
    clearFlora.set(template, v);
    return v;
  };

  const wanted = pos.slice(2);
  const names = (wanted.length ? wanted : readdirSync(root)).filter((n) => existsSync(join(root, n, 'layout.json')));
  console.log(`flora clearance over ${names.length} folders with a layout; ${wantBlocks} blocks sampled a planet, ${cell} m raster, seed ${seed}`);

  /** Every non-zero radius the field resolves to over the planets actually measured, with how many templates carry it. */
  const resolvedValues = new Map<number, Set<string>>();

  for (const name of names) {
    const dir = join(root, name);
    const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
    if (!layout.terrain) continue;
    const t0 = Date.now();
    // A pack missing its named terrain file or its manifest costs that planet and not the run.
    const terrainFile = join(dir, layout.terrain);
    if (!existsSync(terrainFile) || !existsSync(join(dir, 'manifest.json'))) {
      console.log('');
      console.log(`=== ${layout.planet}`);
      console.log(`    SKIPPED: ${!existsSync(terrainFile) ? `its layout names ${layout.terrain} and the pack has not got it` : 'the pack has no manifest.json'}`);
      continue;
    }
    const template = parseTerrainTemplate(new Uint8Array(readFileSync(terrainFile)));
    for (const b of bitmapFiles(template)) {
      const file = join(dir, b.file);
      if (existsSync(file)) attachBitmap(template, b.familyId, new Uint8Array(readFileSync(file)));
    }
    const sampler = new TerrainSampler(template);
    const free: LayoutObject[] = layout.objects.filter((o: LayoutObject) => !o.contained);
    for (const o of free) {
      if (!o.layer) continue;
      const file = join(dir, o.layer);
      if (!existsSync(file)) continue;
      const layer = parseLayerFile(new Uint8Array(readFileSync(file)), template.generator);
      if (layer) sampler.addBuildingLayer(layer, o.x, o.z, yawOf(o.q));
    }
    // Which flora appearances the pack can actually draw; anything else is never planted.
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const drawable = new Set<string>();
    for (const d of manifest.categories?.flora ?? []) if (d.appearance) drawable.add(String(d.appearance).replace(/\\/g, '/').toLowerCase());
    const modelRadius = new Map<string, number>();
    for (const m of manifest.categories?.layout ?? []) if (m?.id) modelRadius.set(m.id, footprintRadius(m.bounds));

    // --- the rules, as discs in the terrain's own frame (the game mirrors X, which moves no distance).
    const now: { x: number; z: number; r: number }[] = [];
    const client: { x: number; z: number; r: number }[] = [];
    /** A third rule, ours, measured only for the sake of the choice: the model's own footprint plus two metres. */
    const footprint: { x: number; z: number; r: number }[] = [];
    const byTemplateNow = new Map<string, { n: number; area: number }>();
    let withRadius = 0;
    let biggerNow = 0;
    let biggerClient = 0;
    let same = 0;
    for (const o of free) {
      const rNow = o.radius >= 1 ? o.radius + 2 : 0;
      const rClient = radiusOf(o.template);
      if (rNow > 0) {
        now.push({ x: o.x, z: o.z, r: rNow });
        const e = byTemplateNow.get(o.template) ?? { n: 0, area: 0 };
        e.n++;
        e.area += Math.PI * rNow * rNow;
        byTemplateNow.set(o.template, e);
      }
      if (rClient > 0) {
        client.push({ x: o.x, z: o.z, r: rClient });
        withRadius++;
      }
      const rFoot = modelRadius.get(o.model) ?? 0;
      if (rFoot > 0) footprint.push({ x: o.x, z: o.z, r: rFoot + 2 });
      if (rNow > rClient) biggerNow++;
      else if (rClient > rNow) biggerClient++;
      else same++;
    }
    const templates = new Set(free.map((o) => o.template));
    const templatesWith = [...templates].filter((t) => radiusOf(t) > 0).length;
    for (const t of templates) {
      const r = radiusOf(t);
      if (r > 0) (resolvedValues.get(r) ?? resolvedValues.set(r, new Set()).get(r)!).add(t);
    }

    const mapWidth = template.mapWidthInMeters;
    const areaNow = excludedArea(now, mapWidth, cell);
    const areaClient = excludedArea(client, mapWidth, cell);
    const areaBoth = excludedArea([...now, ...client], mapWidth, cell);
    const areaFoot = excludedArea(footprint, mapWidth, cell);
    const mapArea = mapWidth * mapWidth;

    // --- plant the flora the way the game plants it, on an even draw of the map's blocks.
    const indexNow = new DiscIndex();
    for (const d of now) indexNow.add(d.x, d.z, d.r);
    const indexClient = new DiscIndex();
    for (const d of client) indexClient.add(d.x, d.z, d.r);
    const indexFoot = new DiscIndex();
    for (const d of footprint) indexFoot.add(d.x, d.z, d.r);
    const bw = sampler.blockWidth;
    const across = Math.max(1, Math.floor(mapWidth / bw));
    const picks = drawIndices(across * across, wantBlocks, seed);
    const counts = { candidates: 0, plantedNow: 0, plantedClient: 0, plantedFoot: 0, freed: 0, lost: 0 };
    const baked = !template.flora.legacyMap && template.flora.collidableMap ? template.flora.collidableMap : null;
    const group = template.generator.floraGroup;
    const collTile = CLEARANCE.collidableTile;
    const collBorder = template.flora.collidable.tileBorder;
    const tilesAcross = Math.floor(mapWidth / collTile);
    const centreTile = Math.floor(tilesAcross / 2);
    const nonTile = template.flora.nonCollidable.tileSize;
    const nonBorder = nonTile - 2 * template.flora.nonCollidable.tileBorder > 0 ? template.flora.nonCollidable.tileBorder : 0;
    for (const pick of picks) {
      const bx = Math.floor((pick % across) - across / 2);
      const bz = Math.floor(Math.floor(pick / across) - across / 2);
      const x0 = bx * bw;
      const z0 = bz * bw;
      const found: Candidate[] = [];
      // Collidable: one candidate per 16 m tile, at the point its own seed puts it.
      for (let tz = Math.floor(z0 / collTile) - 1; tz <= Math.floor((z0 + bw) / collTile) + 1; tz++) {
        for (let tx = Math.floor(x0 / collTile) - 1; tx <= Math.floor((x0 + bw) / collTile) + 1; tx++) {
          const keyX = tx + centreTile;
          const keyZ = tz + centreTile;
          if (keyX < 0 || keyZ < 0 || keyX >= tilesAcross || keyZ >= tilesAcross) continue;
          const rng = new RandomGenerator((keyZ * tilesAcross + keyX) >>> 0);
          const x = tx * collTile + collBorder + rng.randomReal() * (collTile - 2 * collBorder);
          const z = tz * collTile + collBorder + rng.randomReal() * (collTile - 2 * collBorder);
          if (x < x0 || x >= x0 + bw || z < z0 || z >= z0 + bw) continue;
          if (sampler.excludedAt(x, z)) continue;
          const family = baked ? baked.getValue(keyX, keyZ) : sampler.floraAt(x, z, true).family;
          const choice = baked ? hashFloat(hashTuple(Math.floor(x), Math.floor(z))) : sampler.floraAt(x, z, true).choice;
          if (!family) continue;
          const child = group.createFlora(family, choice);
          if (!child) continue;
          found.push({ x, z, drawable: drawable.has(child.appearance.replace(/\\/g, '/').toLowerCase()) });
        }
      }
      // Non-collidable: the same on the template's own tiling.
      if (nonTile >= 0.5) {
        for (let tz = Math.floor(z0 / nonTile) - 1; tz <= Math.floor((z0 + bw) / nonTile) + 1; tz++) {
          for (let tx = Math.floor(x0 / nonTile) - 1; tx <= Math.floor((x0 + bw) / nonTile) + 1; tx++) {
            const rng = new FastRandomGenerator(hashTuple(tx * nonTile, tz * nonTile));
            const x = tx * nonTile + nonBorder + rng.randomFloat() * (nonTile - 2 * nonBorder);
            const z = tz * nonTile + nonBorder + rng.randomFloat() * (nonTile - 2 * nonBorder);
            if (x < x0 || x >= x0 + bw || z < z0 || z >= z0 + bw) continue;
            if (sampler.excludedAt(x, z)) continue;
            const f = sampler.floraAt(x, z, false);
            if (!f.family) continue;
            const child = group.createFlora(f.family, f.choice);
            if (!child) continue;
            found.push({ x, z, drawable: drawable.has(child.appearance.replace(/\\/g, '/').toLowerCase()) });
          }
        }
      }
      for (const c of found) {
        if (!c.drawable) continue;
        counts.candidates++;
        const offNow = indexNow.covers(c.x, c.z);
        const offClient = indexClient.covers(c.x, c.z);
        if (!offNow) counts.plantedNow++;
        if (!offClient) counts.plantedClient++;
        if (!indexFoot.covers(c.x, c.z)) counts.plantedFoot++;
        if (offNow && !offClient) counts.freed++;
        if (offClient && !offNow) counts.lost++;
      }
      sampler.invalidateAll();
    }
    const scale = (across * across) / Math.max(1, picks.length);
    const per = (n: number) => Math.round(n * scale);
    const pctMap = (a: number) => `${((100 * a) / mapArea).toFixed(1)}%`;

    console.log('');
    console.log(`=== ${layout.planet}  (${free.length} placed objects outside cells, ${templates.size} templates, map ${mapWidth} m)`);
    console.log(`    clearFloraRadius: ${templatesWith} of ${templates.size} templates carry one above zero; ${withRadius} of ${free.length} placements would be cleared by it, against ${now.length} today`);
    console.log(`    per placement: today's disc is wider on ${biggerNow}, the client's on ${biggerClient}, the same on ${same}`);
    console.log(`    ground kept clear of flora: today ${(areaNow / 1e6).toFixed(1)} km2 (${pctMap(areaNow)} of the map), by clearFloraRadius ${(areaClient / 1e6).toFixed(2)} km2 (${pctMap(areaClient)}); ${((areaNow - areaClient) / 1e6).toFixed(1)} km2 would stop being excluded, ${((areaBoth - areaNow) / 1e6).toFixed(2)} km2 would start`);
    console.log(`    and by the models' own footprints plus two metres (ours, measured only): ${(areaFoot / 1e6).toFixed(2)} km2 (${pctMap(areaFoot)})`);
    console.log(`    the exclusion index the game builds at load: ${indexEntries(now).toLocaleString('en')} entries today, ${indexEntries(client).toLocaleString('en')} under the client's rule (one per ${CLEARANCE.chunk} m chunk cell each disc touches, written before the first frame)`);
    console.log(`    planted on ${picks.length} sampled blocks (${((picks.length * bw * bw) / 1e6).toFixed(2)} km2, ${((100 * picks.length) / (across * across)).toFixed(2)}% of the map): ${counts.candidates} candidates the pack can draw, ${counts.plantedNow} survive today's rule, ${counts.plantedClient} would survive the client's`);
    console.log(`    scaled to the planet: ${per(counts.plantedNow)} plants today, ${per(counts.plantedClient)} under the client's rule, ${per(counts.plantedFoot)} by the models' own footprints -- ${per(counts.freed)} come back, ${per(counts.lost)} go`);
    const worst = [...byTemplateNow.entries()].sort((a, b) => b[1].area - a[1].area).slice(0, top);
    console.log(`    biggest excluders today (disc area before overlap, and what clearFloraRadius says):`);
    for (const [tpl, e] of worst) console.log(`      ${(e.area / 1e6).toFixed(1)} km2  ${e.n} x r=${(Math.sqrt(e.area / e.n / Math.PI)).toFixed(0)} m  vs ${radiusOf(tpl).toFixed(0)} m  ${tpl}`);
    console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }

  // The values the field really resolves to over the planets just measured -- inheritance folded
  // in, which is what the game would see. It is a different list from the census's, which is what
  // each template sets on its own account, and both are worth printing side by side.
  const rv = [...resolvedValues.entries()].sort((a, b) => a[0] - b[0]);
  if (rv.length) {
    console.log('');
    console.log(`=== across the ${names.length} planets measured, clearFloraRadius resolves to ${rv.length} distinct non-zero values`);
    console.log(`    ${rv.map(([v, ts]) => `${v}(${ts.size} templates)`).join(' ')}`);
    console.log(`    smallest ${rv[0][0]} m, largest ${rv[rv.length - 1][0]} m, over ${new Set(rv.flatMap(([, ts]) => [...ts])).size} templates in all`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
