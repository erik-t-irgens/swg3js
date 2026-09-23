// A terrain audit for a converted planet pack: it reads the pack's own terrain template, the
// building modification layers its layout names, and the layout itself, and prints two things
// per planet -- how far the ground the generator makes sits from the height each placed object
// was authored at, and a census of how steep that ground is, with the worst places named.
//
// It measures and changes nothing. There is no browser, no worker, no renderer and no archive
// here: it reads the converted pack off disk and runs the same TerrainSampler the game runs,
// with the building layers applied exactly as src/world/world.ts applies them.
//
// Run:  node tools/swg/tests/terrainAudit.ts assets-private [planet ...] [--top=8] [--wild=1024]
//
// The pure arithmetic in here (the buckets, the percentiles, the slope, the yaw) is pinned by
// tools/swg/tests/terrainAudit.test.ts, which is what makes the numbers it prints worth reading.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachBitmap, bitmapFiles, ORIGIN_OFFSET, parseLayerFile, parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';

/**
 * Every number the audit judges by is here, and every one of them is ours: nothing in the
 * archives says what a bad slope or a bad authored height is.
 */
export const AUDIT = {
  /** Upper edges of the slope buckets in degrees; anything at or over the last one is "near vertical". */
  slopeEdges: [5, 15, 30, 45, 60, 80],
  /** A pole edge at or past this is flagged and clustered (the last bucket's floor). */
  nearVertical: 80,
  /** An authored height this far from the ground is counted as "on the ground". */
  onGround: 0.5,
  /** Past this, an object is called adrift rather than merely rough. */
  adrift: 5,
  /** How many blocks of open ground to sample away from anything built, for the wild census. */
  wildBlocks: 1024,
  /** How many worst clusters and worst objects to name. */
  top: 8,
  /** A cluster is one sampler block (64 m); two clusters this close are reported as one place. */
  clusterMerge: 160,
  /**
   * An authored height further than this from zero is the snapshot's own nonsense rather than a
   * terrain error: it is counted apart so it cannot drag the error figures around.
   */
  implausible: 10000,
  /**
   * Objects standing on exactly this grid in both x and z are the snapshot's own buildout-area
   * markers rather than anything in the world: one per area, at the area's own corner, at a height
   * that means nothing. The spacing is read off the packs (every such object on every converted
   * planet sits on it) and not out of the archives, so it is a guess of ours, and they are counted
   * apart rather than dropped.
   */
  areaGrid: 2048,
};

/** Whether a point sits exactly on the buildout-area grid (see AUDIT.areaGrid). */
export function onAreaGrid(x: number, z: number, grid: number = AUDIT.areaGrid): boolean {
  return Number.isInteger(x / grid) && Number.isInteger(z / grid);
}

/** Yaw of a layout quaternion [w, x, y, z], exactly as src/world/world.ts reads it for a building layer. */
export function yawOf(q: number[]): number {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

/** The slope of one pole-to-pole edge, in degrees. */
export function slopeDegrees(dh: number, run: number): number {
  return (Math.atan2(Math.abs(dh), run) * 180) / Math.PI;
}

/** Which bucket a slope falls in: 0 for the gentlest, edges.length for anything at or past the last edge. */
export function bucketOf(deg: number, edges: number[] = AUDIT.slopeEdges): number {
  for (let i = 0; i < edges.length; i++) if (deg < edges[i]) return i;
  return edges.length;
}

/** Human labels for the buckets, e.g. "0-5", "5-15", "80+". */
export function bucketLabels(edges: number[] = AUDIT.slopeEdges): string[] {
  const out: string[] = [];
  for (let i = 0; i <= edges.length; i++) out.push(i === 0 ? `0-${edges[0]}` : i === edges.length ? `${edges[i - 1]}+` : `${edges[i - 1]}-${edges[i]}`);
  return out;
}

/** Percentile of an ascending array, linearly interpolated; NaN for an empty one. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  const i = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export interface SlopeCensus {
  /** One count per bucket, buckets as `bucketLabels` names them. */
  counts: number[];
  /** How many pole-to-pole edges were looked at. */
  edges: number;
  /** The degrees of every edge added up, so a mean can be printed beside the bucket shares. */
  sumDeg: number;
  /** The steepest edge found and where it is, in the terrain's own coordinates. */
  worst: { deg: number; x: number; z: number } | null;
  /** Every edge at or past `nearVertical`, as one entry per block with its count and worst. */
  hot: Map<string, { count: number; deg: number; x: number; z: number }>;
}

export function emptyCensus(edges: number[] = AUDIT.slopeEdges): SlopeCensus {
  return { counts: new Array(edges.length + 1).fill(0), edges: 0, sumDeg: 0, worst: null, hot: new Map() };
}

/** The mean slope of everything in a census, in degrees; NaN for an empty one. */
export function meanSlope(c: SlopeCensus): number {
  return c.edges ? c.sumDeg / c.edges : Number.NaN;
}

/**
 * Add one block's pole grid to a census. `lo`..`hi` are the pole indices the block itself owns
 * (its padding poles belong to the neighbour and would be counted twice).
 */
export function censusBlock(into: SlopeCensus, heights: Float32Array, n: number, lo: number, hi: number, startX: number, startZ: number, step: number, key: string, edges: number[] = AUDIT.slopeEdges, nearVertical = AUDIT.nearVertical): void {
  for (let j = lo; j <= hi; j++) {
    for (let i = lo; i <= hi; i++) {
      const h = heights[j * n + i];
      for (let axis = 0; axis < 2; axis++) {
        const i2 = axis === 0 ? i + 1 : i;
        const j2 = axis === 0 ? j : j + 1;
        if (i2 > hi || j2 > hi) continue;
        const deg = slopeDegrees(heights[j2 * n + i2] - h, step);
        into.counts[bucketOf(deg, edges)]++;
        into.edges++;
        into.sumDeg += deg;
        const x = startX + i * step;
        const z = startZ + j * step;
        if (!into.worst || deg > into.worst.deg) into.worst = { deg, x, z };
        if (deg >= nearVertical) {
          const e = into.hot.get(key);
          if (!e) into.hot.set(key, { count: 1, deg, x, z });
          else {
            e.count++;
            if (deg > e.deg) {
              e.deg = deg;
              e.x = x;
              e.z = z;
            }
          }
        }
      }
    }
  }
}

export interface HeightErrors {
  /** |ground - authored| for every object looked at, ascending. */
  sorted: number[];
  onGround: number;
  rough: number;
  adrift: number;
  worst: { d: number; err: number; x: number; z: number; template: string }[];
}

/**
 * Summarise a planet's authored-height errors (`err` is the ground minus the authored height).
 * The counts cover everything; the worst list leaves out the area markers, which would otherwise
 * be the whole of it on every planet and would tell the owner nothing they can go and look at.
 */
export function summariseHeights(items: { err: number; x: number; z: number; template: string }[], top = AUDIT.top): HeightErrors {
  const sorted = items.map((i) => Math.abs(i.err)).sort((a, b) => a - b);
  const worst = items
    .filter((i) => !onAreaGrid(i.x, i.z))
    .map((i) => ({ d: Math.abs(i.err), err: i.err, x: i.x, z: i.z, template: i.template }))
    .sort((a, b) => b.d - a.d)
    .slice(0, top);
  return {
    sorted,
    onGround: sorted.filter((d) => d <= AUDIT.onGround).length,
    rough: sorted.filter((d) => d > AUDIT.onGround && d <= AUDIT.adrift).length,
    adrift: sorted.filter((d) => d > AUDIT.adrift).length,
    worst,
  };
}

/** Merge hot blocks that sit within `merge` metres of each other, strongest first. */
export function clusters(hot: Map<string, { count: number; deg: number; x: number; z: number }>, merge = AUDIT.clusterMerge): { count: number; deg: number; x: number; z: number; blocks: number }[] {
  const items = [...hot.values()].sort((a, b) => b.count - a.count || b.deg - a.deg);
  const out: { count: number; deg: number; x: number; z: number; blocks: number }[] = [];
  for (const it of items) {
    const near = out.find((o) => Math.hypot(o.x - it.x, o.z - it.z) <= merge);
    if (near) {
      near.count += it.count;
      near.blocks++;
      if (it.deg > near.deg) {
        near.deg = it.deg;
        near.x = it.x;
        near.z = it.z;
      }
    } else out.push({ count: it.count, deg: it.deg, x: it.x, z: it.z, blocks: 1 });
  }
  return out.sort((a, b) => b.count - a.count);
}

interface Poi {
  name: string;
  x: number;
  z: number;
  r: number;
  kind: string;
}

/**
 * The nearest named place to a point, from the pack's own pois.json when it has one.
 *
 * A point usually stands inside several places at once -- a town inside a swamp inside a whole
 * range of hills -- and the name worth printing is the **tightest** one that contains it, never
 * the widest. So every place that contains the point beats every place that does not, and among
 * those the smallest radius wins (the nearer centre breaking a tie between two the same size).
 * Among places that do not contain it, the one whose *edge* is nearest wins and that edge
 * distance is what is printed, because a place three kilometres wide has a centre nobody is
 * standing anywhere near.
 *
 * (An earlier rule scored a containing place `distance - radius`, which made the *largest*
 * enclosing place always win: on Corellia a point 442 m inside a 1168 m place and 2144 m inside a
 * 3328 m one was named by the second. The audit's whole job here is to send the owner somewhere
 * they can walk to, so that is a real error and not a matter of taste.)
 *
 * The names themselves are whatever the last `pois` run wrote into the pack. Today that is the
 * emulator's Lua region names rather than the client's own named-places table, so a name printed
 * here is only as good as that list; a pack with no pois.json simply gets no name.
 */
export function nameAt(pois: Poi[], x: number, z: number): string {
  interface Cand {
    p: Poi;
    inside: boolean;
    r: number;
    d: number;
    edge: number;
  }
  let best: Cand | null = null;
  for (const p of pois) {
    const r = Math.max(p.r, 0);
    const d = Math.hypot(p.x - x, p.z - z);
    // A place with no radius of its own still counts as "in" from a metre away, or a landmark
    // could never name the point standing on it.
    const cand: Cand = { p, inside: d <= Math.max(r, 1), r, d, edge: Math.max(0, d - r) };
    if (!best) {
      best = cand;
      continue;
    }
    if (cand.inside !== best.inside) {
      if (cand.inside) best = cand;
      continue;
    }
    if (cand.inside) {
      if (cand.r < best.r || (cand.r === best.r && cand.d < best.d)) best = cand;
    } else if (cand.edge < best.edge || (cand.edge === best.edge && cand.d < best.d)) best = cand;
  }
  if (!best) return 'unnamed';
  return best.inside ? `in ${best.p.name}` : `${Math.round(best.edge)} m from ${best.p.name}`;
}

// ---------------------------------------------------------------------------------------------
// The run itself.

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

function loadPack(dir: string): { layout: { planet: string; center: { x: number; z: number }; terrain: string | null; objects: LayoutObject[] }; pois: Poi[] } | null {
  const lp = join(dir, 'layout.json');
  if (!existsSync(lp)) return null;
  const layout = JSON.parse(readFileSync(lp, 'utf8'));
  if (!layout.terrain) return null;
  let pois: Poi[] = [];
  const pp = join(dir, 'pois.json');
  if (existsSync(pp)) {
    try {
      pois = JSON.parse(readFileSync(pp, 'utf8')).pois ?? [];
    } catch {
      pois = [];
    }
  }
  return { layout, pois };
}

export function auditPack(dir: string, opts: { top?: number; wildBlocks?: number; log?: (line: string) => void } = {}): void {
  const log = opts.log ?? ((l: string) => console.log(l));
  const top = opts.top ?? AUDIT.top;
  const wildWanted = opts.wildBlocks ?? AUDIT.wildBlocks;
  const pack = loadPack(dir);
  if (!pack) return;
  const { layout, pois } = pack;
  const t0 = Date.now();
  // One pack that names a terrain file it has not got must cost that planet and not the run: an
  // eighteen-world sweep that throws in the middle has measured nothing it can print.
  let template;
  try {
    template = parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, layout.terrain!))));
  } catch (e) {
    log('');
    log(`=== ${layout.planet}`);
    log(`    SKIPPED: its layout names ${layout.terrain} and the pack cannot read it (${(e as Error).message})`);
    return;
  }
  let bitmaps = 0;
  let bitmapsMissing = 0;
  for (const b of bitmapFiles(template)) {
    const file = join(dir, b.file);
    if (existsSync(file) && attachBitmap(template, b.familyId, new Uint8Array(readFileSync(file)))) bitmaps++;
    else bitmapsMissing++;
  }
  const sampler = new TerrainSampler(template);
  const free = layout.objects.filter((o) => !o.contained);
  let layersAdded = 0;
  let layersMissing = 0;
  let layersUnreadable = 0;
  for (const o of free) {
    if (!o.layer) continue;
    const file = join(dir, o.layer);
    if (!existsSync(file)) {
      layersMissing++;
      continue;
    }
    const layer = parseLayerFile(new Uint8Array(readFileSync(file)), template.generator);
    if (!layer) {
      layersUnreadable++;
      continue;
    }
    sampler.addBuildingLayer(layer, o.x, o.z, yawOf(o.q));
    layersAdded++;
  }

  log('');
  log(`=== ${layout.planet}  (${free.length} placed objects outside cells, map ${template.mapWidthInMeters} m, poles every ${sampler.poleStep} m)`);
  log(`    terrain ${template.name.replace(/\\/g, '/').split('/').pop()} v${template.version}; ${layersAdded} building layers applied${layersMissing ? `, ${layersMissing} layer files missing from the pack` : ''}${layersUnreadable ? `, ${layersUnreadable} unreadable` : ''}; ${bitmaps} bitmaps attached${bitmapsMissing ? `, ${bitmapsMissing} missing (their filter passes everywhere)` : ''}`);

  // --- authored height against the ground, one sampler block at a time so memory stays flat.
  const bw = sampler.blockWidth;
  const keyed = free
    .map((o) => ({ o, bx: Math.floor(o.x / bw), bz: Math.floor(o.z / bw) }))
    .sort((a, b) => a.bz - b.bz || a.bx - b.bx);
  const items: { err: number; x: number; z: number; template: string }[] = [];
  const nonsense: { y: number; x: number; z: number; template: string }[] = [];
  let lastKey = '';
  for (const k of keyed) {
    const key = `${k.bx},${k.bz}`;
    if (key !== lastKey) {
      sampler.invalidateAll();
      lastKey = key;
    }
    if (!Number.isFinite(k.o.y) || Math.abs(k.o.y) > AUDIT.implausible) {
      nonsense.push({ y: k.o.y, x: k.o.x, z: k.o.z, template: k.o.template });
      continue;
    }
    items.push({ err: sampler.heightAt(k.o.x, k.o.z) - k.o.y, x: k.o.x, z: k.o.z, template: k.o.template });
  }
  sampler.invalidateAll();
  const h = summariseHeights(items, top);
  const pct = (n: number) => `${((100 * n) / Math.max(1, items.length)).toFixed(1)}%`;
  log(`    authored height: ${h.onGround} on the ground (within ${AUDIT.onGround} m, ${pct(h.onGround)}), ${h.rough} within ${AUDIT.adrift} m (${pct(h.rough)}), ${h.adrift} further (${pct(h.adrift)})`);
  log(`      |error| median ${percentile(h.sorted, 0.5).toFixed(2)} m, p90 ${percentile(h.sorted, 0.9).toFixed(2)} m, p99 ${percentile(h.sorted, 0.99).toFixed(2)} m, worst ${percentile(h.sorted, 1).toFixed(1)} m (area markers counted; the list below leaves them out)`);
  for (const w of h.worst) log(`      ${w.err >= 0 ? '+' : ''}${w.err.toFixed(1)} m at ${w.x.toFixed(0)}, ${w.z.toFixed(0)} (${nameAt(pois, w.x, w.z)})  ${w.template}`);
  const markers = items.filter((i) => onAreaGrid(i.x, i.z));
  if (markers.length) {
    const off = markers.map((m) => Math.abs(m.err)).sort((a, b) => a - b);
    const templates = new Set(markers.map((m) => m.template));
    log(`    FLAG ${markers.length} objects stand exactly on the ${AUDIT.areaGrid} m buildout-area grid (${templates.size} template${templates.size === 1 ? '' : 's'}), median ${percentile(off, 0.5).toFixed(0)} m off the ground, worst ${percentile(off, 1).toFixed(0)} m:`);
    log(`      they are area markers, they are drawn, and each one keeps flora off a disc of its own; they are in the counts above and out of the worst list.`);
    for (const t of [...templates].slice(0, 2)) log(`      ${t}`);
  }
  if (nonsense.length) {
    log(`    FLAG ${nonsense.length} objects the snapshot authors past +-${AUDIT.implausible} m; they are left out of the figures above:`);
    for (const n of nonsense.slice(0, Math.min(3, top))) log(`      y ${n.y.toFixed(0)} m at ${n.x.toFixed(0)}, ${n.z.toFixed(0)} (${nameAt(pois, n.x, n.z)})  ${n.template}`);
  }

  // --- slope, in two frames: the ground people walk on (blocks holding something placed) and
  //     a sample of the open country away from it.
  const built = new Set<string>();
  for (const o of free) built.add(`${Math.floor(o.x / bw)},${Math.floor(o.z / bw)}`);
  const blockOf = (key: string) => key.split(',').map(Number);
  const builtCensus = emptyCensus();
  const runBlock = (bx: number, bz: number, into: SlopeCensus) => {
    const s = sampler.blockStart(bx, bz);
    const g = sampler.generate(s.x, s.z, sampler.numberOfPoles, sampler.poleStep);
    censusBlock(into, g.heights, sampler.numberOfPoles, ORIGIN_OFFSET, ORIGIN_OFFSET + 2 * sampler.tilesPerBlock, s.x, s.z, sampler.poleStep, `${bx},${bz}`);
  };
  for (const key of built) {
    const [bx, bz] = blockOf(key);
    runBlock(bx, bz, builtCensus);
  }
  // The open country: an even lattice over the map, skipping anything already counted.
  const wildCensus = emptyCensus();
  const half = template.mapWidthInMeters / 2;
  const blocksAcross = Math.max(1, Math.floor(template.mapWidthInMeters / bw));
  const stride = Math.max(1, Math.round(blocksAcross / Math.sqrt(wildWanted)));
  let wildBlocks = 0;
  for (let j = 0; j < blocksAcross; j += stride) {
    for (let i = 0; i < blocksAcross; i += stride) {
      const bx = Math.floor((-half + i * bw) / bw);
      const bz = Math.floor((-half + j * bw) / bw);
      if (built.has(`${bx},${bz}`)) continue;
      runBlock(bx, bz, wildCensus);
      wildBlocks++;
    }
  }
  const labels = bucketLabels();
  const line = (c: SlopeCensus) => c.counts.map((n, i) => `${labels[i]}deg ${((100 * n) / Math.max(1, c.edges)).toFixed(2)}%`).join('  ');
  log(`    slope where things are built (${built.size} blocks, ${builtCensus.edges} edges, mean ${meanSlope(builtCensus).toFixed(2)} deg): ${line(builtCensus)}`);
  log(`    slope in open country (${wildBlocks} blocks, ${wildCensus.edges} edges, mean ${meanSlope(wildCensus).toFixed(2)} deg): ${line(wildCensus)}`);
  // Near-vertical ground in open country is a cliff and is the planet's own; near-vertical ground
  // where something is built is the flag, because nobody authored a wall of dirt through a town.
  const builtHot = clusters(builtCensus.hot);
  const wildHot = clusters(wildCensus.hot);
  const last = labels.length - 1;
  if (!builtCensus.counts[last]) log(`    nothing at or past ${AUDIT.nearVertical} degrees where anything is built.`);
  else {
    log(`    FLAG ${builtCensus.counts[last]} pole edges at or past ${AUDIT.nearVertical} degrees where things are built, in ${builtHot.length} places:`);
    for (const c of builtHot.slice(0, top)) log(`      ${c.count} edges up to ${c.deg.toFixed(1)} deg around ${c.x.toFixed(0)}, ${c.z.toFixed(0)} (${nameAt(pois, c.x, c.z)})`);
  }
  if (wildCensus.counts[last]) log(`    ${wildCensus.counts[last]} near-vertical edges in the open-country sample, steepest ${(wildHot[0]?.deg ?? 0).toFixed(1)} deg at ${(wildHot[0]?.x ?? 0).toFixed(0)}, ${(wildHot[0]?.z ?? 0).toFixed(0)} (cliffs; the planet's own).`);
  if (layersMissing) log(`    FLAG ${layersMissing} building layer files the layout names are not in the pack: the ground under them is unmodified.`);
  log(`    (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const flags = new Map(argv.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? '']));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const root = positional[0] ?? 'assets-private';
  if (!existsSync(root)) {
    console.error(`terrainAudit: no such folder ${root}\nusage: node tools/swg/tests/terrainAudit.ts <assets-dir> [planet ...] [--top=8] [--wild=1024]`);
    process.exit(1);
  }
  const wanted = positional.slice(1);
  const names = (wanted.length ? wanted : readdirSync(root)).filter((n) => existsSync(join(root, n, 'layout.json')));
  const opts = { top: Number(flags.get('top') ?? AUDIT.top), wildBlocks: Number(flags.get('wild') ?? AUDIT.wildBlocks) };
  console.log(`terrain audit of ${root}: ${names.length} folders with a layout, buckets ${bucketLabels().join(' ')} degrees`);
  for (const n of names) auditPack(join(root, n), opts);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
