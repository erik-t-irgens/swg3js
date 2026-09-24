// Pins the arithmetic the terrain audit and the flora-clearance measurement print numbers with,
// and runs the audit end to end over a synthetic pack built in memory, so that a figure either
// tool reports can be trusted to be the thing it says it is.
//
// Run: node tools/swg/tests/terrainAudit.test.ts

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { form, chunk, W, encode } from './iffWriter.ts';
import { AUDIT, auditPack, bucketLabels, bucketOf, censusBlock, clusters, emptyCensus, floraTilePoint, meanSlope, nameAt, onAreaGrid, percentile, slopeDegrees, summariseBaked, summariseHeights, yawOf } from './terrainAudit.ts';
import { CLEARANCE, DiscIndex, drawIndices, excludedArea, floatParam, footprintRadius, indexEntries, ownClearFlora, ringArea } from './floraClearance.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- the layout quaternion's yaw, which is how a building layer is turned. [w, x, y, z].
{
  const half = Math.SQRT1_2;
  check('yaw of the identity turn is zero', near(yawOf([1, 0, 0, 0]), 0));
  check('yaw of a quarter turn about Y', near(yawOf([half, 0, half, 0]), Math.PI / 2, 1e-9), String(yawOf([half, 0, half, 0])));
  check('yaw of a half turn about Y', near(Math.abs(yawOf([0, 0, 1, 0])), Math.PI, 1e-9));
  // A gentle turn about X alone leaves the yaw at zero. (A quarter turn about X does not: the
  // formula's own denominator reaches zero there and the answer flips to a half turn, which is
  // what the game does with it too, so the audit inherits it rather than papering over it.)
  const c15 = Math.cos(Math.PI / 12);
  const s15 = Math.sin(Math.PI / 12);
  check('a gentle turn about X alone has no yaw', near(yawOf([c15, s15, 0, 0]), 0, 1e-9), String(yawOf([c15, s15, 0, 0])));
  // The audit's yawOf is a copy of the game's, because src/world/world.ts cannot be loaded under
  // node. Pinning the copy's own answers says nothing about whether it still matches, so the
  // game's own line is read as text here, exactly as the flora copies are below.
  const worldSrc = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8');
  check(
    'the game still takes a layer s yaw the way this copy does',
    /return Math\.atan2\(2 \* \(x \* z \+ w \* y\), 1 - 2 \* \(x \* x \+ y \* y\)\);/.test(worldSrc),
    'src/world/world.ts yawOf has moved: update terrainAudit.ts to match, deliberately',
  );
}

// --- slope and its buckets
{
  check('a level edge is flat', near(slopeDegrees(0, 2), 0));
  check('as far up as along is 45 degrees', near(slopeDegrees(2, 2), 45, 1e-9));
  check('slope does not care which way the drop goes', near(slopeDegrees(-7, 2), slopeDegrees(7, 2)));
  check('a big drop over a short run is near vertical', slopeDegrees(200, 2) > 89 && slopeDegrees(200, 2) < 90);
  check('buckets are ordered and the last one is open', bucketOf(0) === 0 && bucketOf(4.99) === 0 && bucketOf(5) === 1 && bucketOf(79.9) === 5 && bucketOf(80) === 6 && bucketOf(90) === 6);
  check('bucket labels match the edges', bucketLabels().join(' ') === '0-5 5-15 15-30 30-45 45-60 60-80 80+', bucketLabels().join(' '));
  check('the near-vertical bucket is the last one', bucketOf(AUDIT.nearVertical) === AUDIT.slopeEdges.length);
}

// --- percentiles
{
  const s = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  check('percentile ends', percentile(s, 0) === 0 && percentile(s, 1) === 10);
  check('percentile middle', percentile(s, 0.5) === 5);
  check('percentile interpolates', near(percentile([0, 10], 0.25), 2.5));
  check('percentile of nothing is not a number', Number.isNaN(percentile([], 0.5)));
  check('percentile clamps out-of-range asks', percentile(s, -1) === 0 && percentile(s, 2) === 10);
}

// --- a block's census: a ramp of a known steepness, then one cliff edge in it
{
  const n = 36;
  const lo = 2;
  const hi = 2 + 2 * 16;
  const step = 2;
  const heights = new Float32Array(n * n);
  // Height rises 2 m per pole along x: every x edge is 45 degrees, every z edge is flat.
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = 2 * i;
  const c = emptyCensus();
  censusBlock(c, heights, n, lo, hi, 0, 0, step, '0,0');
  const xEdges = (hi - lo) * (hi - lo + 1);
  const zEdges = xEdges;
  check('the census counts every edge in the block once', c.edges === xEdges + zEdges, `${c.edges} vs ${xEdges + zEdges}`);
  check('a 45 degree ramp lands in the 45-60 bucket with the flat edges in the first', c.counts[4] === xEdges && c.counts[0] === zEdges, JSON.stringify(c.counts));
  check('nothing near vertical in a ramp', c.counts[6] === 0 && c.hot.size === 0);
  // Half the edges are 45 degrees and half are flat, so the mean is 22.5. The mean is what makes
  // "this frame is steeper than that one" a number rather than a feeling.
  check('the mean slope is the mean of the edges, not of the buckets', near(meanSlope(c), 22.5, 1e-9), String(meanSlope(c)));
  check('an empty census has no mean', Number.isNaN(meanSlope(emptyCensus())));
  // Now put one step of 200 m in, which is a wall.
  heights[10 * n + 10] += 200;
  const c2 = emptyCensus();
  censusBlock(c2, heights, n, lo, hi, 100, -50, step, '1,-1');
  check('a wall is counted as near vertical and clustered under its block', c2.counts[6] === 4 && c2.hot.get('1,-1')?.count === 4, `${c2.counts[6]} ${JSON.stringify([...c2.hot])}`);
  check('the worst edge carries its own place', !!c2.worst && c2.worst.deg > 89 && c2.worst.x >= 100 && c2.worst.z >= -50, JSON.stringify(c2.worst));
}

// --- clusters
{
  const hot = new Map([
    ['a', { count: 10, deg: 81, x: 0, z: 0 }],
    ['b', { count: 5, deg: 88, x: 64, z: 0 }],
    ['c', { count: 3, deg: 82, x: 5000, z: 5000 }],
  ]);
  const cl = clusters(hot, 160);
  check('near blocks merge and far ones do not', cl.length === 2 && cl[0].count === 15 && cl[0].blocks === 2 && cl[0].deg === 88, JSON.stringify(cl));
  check('the merged cluster keeps the steepest edge s place', cl[0].x === 64 && cl[0].z === 0, JSON.stringify(cl[0]));
  check('a merge distance of zero keeps them apart', clusters(hot, 0).length === 3);
}

// --- authored heights, and the buildout-area markers
{
  check('the area grid is exact in both axes', onAreaGrid(0, 2048) && onAreaGrid(-4096, 6144) && !onAreaGrid(2048, 100) && !onAreaGrid(1, 1));
  const items = [
    { err: 0.1, x: 10, z: 10, template: 'a' },
    { err: 3, x: 20, z: 20, template: 'b' },
    { err: -40, x: 30, z: 30, template: 'c' },
    { err: 400, x: 0, z: 2048, template: 'marker' },
  ];
  const h = summariseHeights(items, 4);
  check('the counts cover everything including the markers', h.onGround === 1 && h.rough === 1 && h.adrift === 2, JSON.stringify([h.onGround, h.rough, h.adrift]));
  check('the worst list leaves the markers out', h.worst.length === 3 && h.worst[0].template === 'c' && !h.worst.some((w) => w.template === 'marker'), JSON.stringify(h.worst.map((w) => w.template)));
  check('the errors keep their sign for the report', h.worst[0].err === -40 && h.worst[0].d === 40);
}

// --- naming a place from a pack's own points of interest
{
  const pois = [
    { name: 'Town', x: 100, z: 100, r: 50, kind: 'city' },
    { name: 'Rock', x: 900, z: 100, r: 0, kind: 'landmark' },
  ];
  check('a point inside a place is named as inside it', nameAt(pois, 110, 100) === 'in Town', nameAt(pois, 110, 100));
  check('a point outside carries its distance', nameAt(pois, 700, 100) === '200 m from Rock', nameAt(pois, 700, 100));
  check('with no places nothing is named', nameAt([], 0, 0) === 'unnamed');

  // The case the rule exists to decide: a point standing inside more than one place at once. The
  // owner has to be able to walk to what the audit names, so the tightest place wins and the
  // widest one never does -- whichever order the list happens to be in. The numbers are the real
  // Corellia ones the first version of this got wrong: 442 m into a place of radius 1168, and
  // 2144 m into a place of radius 3328 that contains it.
  const nested = [
    { name: 'Range', x: 2144, z: 0, r: 3328, kind: 'area' },
    { name: 'Swamp', x: 442, z: 0, r: 1168, kind: 'area' },
    { name: 'Town', x: 60, z: 0, r: 120, kind: 'city' },
  ];
  check('the tightest place containing a point wins, not the widest', nameAt(nested, 0, 0) === 'in Town', nameAt(nested, 0, 0));
  check('and still wins with the list the other way round', nameAt([...nested].reverse(), 0, 0) === 'in Town', nameAt([...nested].reverse(), 0, 0));
  check('a point in the two wide places but not the town takes the tighter of them', nameAt(nested, 600, 0) === 'in Swamp', nameAt(nested, 600, 0));
  check('a point only the widest place holds takes it', nameAt(nested, 3000, 0) === 'in Range', nameAt(nested, 3000, 0));
  // Outside everything, the place whose EDGE is nearest wins, and that edge is what is printed:
  // a 3.3 km region whose centre is 5 km away is not "5000 m from" anywhere useful.
  const outside = [
    { name: 'Wide', x: 0, z: 0, r: 1000, kind: 'area' },
    { name: 'Near', x: 1300, z: 0, r: 10, kind: 'landmark' },
  ];
  check('outside everything, the nearest edge wins', nameAt(outside, 1400, 0) === '90 m from Near', nameAt(outside, 1400, 0));
  check('and a wide place is reported from its edge, not its centre', nameAt(outside, 1100, 0) === '100 m from Wide', nameAt(outside, 1100, 0));
  check('a containing place always beats one that only comes close', nameAt([{ name: 'Big', x: 0, z: 0, r: 5000, kind: 'area' }, { name: 'Small', x: 60, z: 0, r: 10, kind: 'city' }], 0, 0) === 'in Big', nameAt([{ name: 'Big', x: 0, z: 0, r: 5000, kind: 'area' }, { name: 'Small', x: 60, z: 0, r: 10, kind: 'city' }], 0, 0));
  check('two places the same size are split by the nearer centre', nameAt([{ name: 'Far', x: 90, z: 0, r: 100, kind: 'a' }, { name: 'Close', x: 10, z: 0, r: 100, kind: 'a' }], 0, 0) === 'in Close');
}

// --- the template float parameter clearFloraRadius is read out of
{
  const single = Buffer.from([1, 32, 0, 0, 0, 0]);
  single.writeFloatLE(38, 2);
  check('a set float parameter reads its value', floatParam(single) === 38, String(floatParam(single)));
  check('a parameter a template only declares reads as unset', floatParam(Buffer.from([0, 32])) === null);
  check('a truncated parameter reads as unset', floatParam(Buffer.from([1, 32, 0])) === null);
  check('no parameter at all reads as unset', floatParam(null) === null && floatParam(undefined) === null);
  const zero = Buffer.from([1, 32, 0, 0, 0, 0]);
  check('a float parameter set to zero is a value, not an absence', floatParam(zero) === 0);
  // The archive census needs the three cases kept apart, which floatParam folds into two: a
  // template with no such parameter at all, one that declares it and leaves it to its base, and
  // one that sets it (to zero, or to something).
  check('a template with no such parameter reads as absent', ownClearFlora(null) === 'absent' && ownClearFlora(undefined) === 'absent' && ownClearFlora(Buffer.alloc(0)) === 'absent');
  check('a declared but unset parameter reads as declared', ownClearFlora(Buffer.from([0, 32])) === 'declared');
  check('a truncated set parameter is not read as a value', ownClearFlora(Buffer.from([1, 32, 0])) === 'declared');
  check('a set parameter reads its own float', ownClearFlora(single) === 38 && ownClearFlora(zero) === 0);
}

// --- the exclusion arithmetic
{
  check('a ring between two radii', near(ringArea(3, 1), Math.PI * 8, 1e-9) && ringArea(1, 3) === 0);
  // One disc on a raster: the area is pi r squared to within the raster's own step.
  const r = 100;
  const one = excludedArea([{ x: 0, z: 0, r }], 4096, 4);
  check('one disc measures its own area', Math.abs(one - Math.PI * r * r) / (Math.PI * r * r) < 0.01, `${one} vs ${Math.PI * r * r}`);
  const two = excludedArea([{ x: 0, z: 0, r }, { x: 50, z: 0, r }], 4096, 4);
  check('two discs that overlap are not counted twice', two < 2 * one && two > one, `${two} vs ${one}`);
  const clipped = excludedArea([{ x: 0, z: 0, r: 1e5 }], 1024, 4);
  check('a disc wider than the map covers the map and no more', near(clipped, 1024 * 1024, 1), String(clipped));
  check('a disc with no radius covers nothing', excludedArea([{ x: 0, z: 0, r: 0 }], 1024, 4) === 0);
  // The index the game builds: one entry per chunk cell a disc touches.
  check('a small disc files one row of cells', indexEntries([{ x: 32, z: 32, r: 1 }], 64) === 1, String(indexEntries([{ x: 32, z: 32, r: 1 }], 64)));
  check('a 64 m disc on a cell corner files four', indexEntries([{ x: 0, z: 0, r: 1 }], 64) === 4, String(indexEntries([{ x: 0, z: 0, r: 1 }], 64)));
  check('a wide disc files a square of cells', indexEntries([{ x: 32, z: 32, r: 320 }], 64) === 11 * 11, String(indexEntries([{ x: 32, z: 32, r: 320 }], 64)));
}

// --- the disc index, which answers the same question a great many times
{
  const idx = new DiscIndex(64, 512);
  idx.add(0, 0, 10);
  idx.add(10000, 10000, 5000); // wider than the limit: it goes in the list scanned outright
  check('a point inside a small disc is covered', idx.covers(5, 5) && idx.covers(0, 10));
  check('a point outside every disc is not', !idx.covers(30, 0) && !idx.covers(-4000, -4000));
  check('a wide disc is found wherever it reaches', idx.covers(10000, 14900) && idx.covers(6000, 10000));
  check('and not past its edge', !idx.covers(10000, 15100));
  check('an empty index covers nothing', !new DiscIndex().covers(0, 0));
  check('a disc with no radius is not filed', !(() => { const i = new DiscIndex(); i.add(0, 0, 0); return i.covers(0, 0); })());
}

// --- the seeded draw the sampling uses
{
  const a = drawIndices(1000, 50, 1);
  const b = drawIndices(1000, 50, 1);
  const c = drawIndices(1000, 50, 2);
  check('the draw is the same twice with one seed', a.join() === b.join());
  check('a different seed draws differently', a.join() !== c.join());
  check('the draw is inside the range, distinct and ascending', a.every((v, i) => v >= 0 && v < 1000 && (i === 0 || v > a[i - 1])));
  check('asking for more than there is gives all of it', drawIndices(20, 100, 1).length === 20);
  check('the sampling numbers are ours and named', CLEARANCE.blocks > 0 && CLEARANCE.cell > 0 && CLEARANCE.top > 0);
}

// --- a model's own footprint, which is the third rule the measurement prices
{
  const centred = { min: [-4, 0, -3], max: [4, 6, 3] };
  check('a centred box reaches its own half diagonal', near(footprintRadius(centred), Math.hypot(4, 3), 1e-9), String(footprintRadius(centred)));
  const offset = { min: [10, 0, 0], max: [18, 6, 6] };
  check('a box off the origin reaches further', near(footprintRadius(offset), Math.hypot(14, 3) + Math.hypot(4, 3), 1e-9), String(footprintRadius(offset)));
  const swapped = { min: [4, 6, 3], max: [-4, 0, -3] };
  check('a pack with its corners the other way round measures the same', near(footprintRadius(swapped), footprintRadius(centred), 1e-9));
  check('no bounds at all measure nothing', footprintRadius(null) === 0 && footprintRadius(undefined) === 0);
}

// --- the flora arithmetic this measurement copies out of the game must still read the same way.
// It is a copy because src/world/flora.ts imports three and cannot be loaded under node; if the
// game's own planting moves, this is what says so rather than the numbers quietly going wrong.
{
  const src = readFileSync(new URL('../../../src/world/flora.ts', import.meta.url), 'utf8');
  check('the engine s collidable flora tile is still 16 m', new RegExp(`const COLLIDABLE_TILE = ${CLEARANCE.collidableTile};`).test(src), `CLEARANCE.collidableTile is ${CLEARANCE.collidableTile}`);
  check('a collidable plant still lands at tile + border + a drawn share of the rest', /const x = tx \* COLLIDABLE_TILE \+ border \+ xOffset \* \(COLLIDABLE_TILE - 2 \* border\);/.test(src));
  check('a collidable tile is still seeded by its own key', /const random = new RandomGenerator\(key\);/.test(src));
  check('a non-collidable plant is still seeded from its tile corner', /const rng = new FastRandomGenerator\(hashTuple\(tx \* tile, tz \* tile\)\);/.test(src));
  check('the terrain s own exclusion still drops a plant', /if \(this\.swg\.sampler\.excludedAt\(x, z\)\) continue;/.test(src));
  // The sixth copied number: the chunk the exclusion index is filed into. It had no guard, which
  // made it the one value that could silently falsify indexEntries.
  const terrainSrc = readFileSync(new URL('../../../src/world/terrain.ts', import.meta.url), 'utf8');
  check('the engine s terrain chunk is still what the index count assumes', new RegExp(`export const CHUNK_SIZE = ${CLEARANCE.chunk};`).test(terrainSrc), `CLEARANCE.chunk is ${CLEARANCE.chunk}`);
  const stream = readFileSync(new URL('../../../src/world/layoutStream.ts', import.meta.url), 'utf8');
  // A guard on the rule the measurement PRICES, not on a copy. It went red once, on purpose, the
  // day the rule changed: the game no longer excludes by the snapshot's radius but by the model's
  // own reach (`src/world/floraClear.ts`) -- which is the third rule this very measurement priced,
  // and the one it found lands within 2% of the client's own `clearFloraRadius` counts while
  // needing no reconversion. So the table's two columns are now "before" (the snapshot rule, which
  // `--rule=snapshot` still measures) and "after" (what the game does). The guard pins the new rule
  // the same way: if it goes red again, whoever moves the rule re-reads the table in that commit.
  check(
    'the rule being measured is still the model reach the game now uses',
    /floraClearRadius\(o\.radius, this\.pack\.find\(o\.model\)\?\.bounds \?\? null\)/.test(stream),
    'layoutStream.ts no longer excludes by the model reach: re-read the measurement with whatever replaced it',
  );
}

// --- the audit end to end over a pack built here: flat ground, two objects, one of them adrift
{
  const dir = mkdtempSync(join(tmpdir(), 'swg-audit-'));
  try {
    // A terrain with no layers at all: every height is zero, so the ground is a plane.
    const header = new W().str('flat').f32(1024).f32(32).i32(8).i32(0).f32(0).f32(2).str('').f32(60)
      .f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(0).bytes();
    const tgen = form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), form('MGRP', form('0000')), form('LYRS')));
    writeFileSync(join(dir, 'terrain.trn'), encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE')))));
    const q = [1, 0, 0, 0];
    writeFileSync(join(dir, 'layout.json'), JSON.stringify({
      planet: 'flat',
      center: { x: 0, z: 0 },
      terrain: 'terrain.trn',
      objects: [
        { template: 'on/the/ground', model: 'a', x: 100, y: 0, z: 100, q, radius: 8 },
        { template: 'up/in/the/air', model: 'b', x: 140, y: 40, z: 100, q, radius: 8 },
        { template: 'the/area/marker', model: 'c', x: 0, y: 300, z: 2048, q, radius: 200 },
        { template: 'in/a/room', model: 'd', x: 3, y: 900, z: 4, q, radius: 8, contained: true },
      ],
    }));
    writeFileSync(join(dir, 'pois.json'), JSON.stringify({ planet: 'flat', center: { x: 0, z: 0 }, pois: [{ name: 'Somewhere', x: 140, z: 100, r: 60, kind: 'city' }] }));
    mkdirSync(join(dir, 'terrain'), { recursive: true });
    const lines: string[] = [];
    auditPack(dir, { top: 4, wildBlocks: 64, log: (l) => lines.push(l) });
    const all = lines.join('\n');
    const bit = (re: RegExp) => (all.split('\n').find((l) => re.test(l)) ?? 'no such line').trim();
    check('the audit reads the pack and counts what is outside cells', /3 placed objects outside cells/.test(all), bit(/placed objects/));
    check('it puts the object on the ground and the ones off it apart', /1 on the ground \(within 0\.5 m, 33\.3%\)/.test(all) && /2 further \(66\.7%\)/.test(all), bit(/authored height/));
    check('the worst error is the object in the air, signed and named', /-40\.0 m at 140, 100 \(in Somewhere\)  up\/in\/the\/air/.test(all), bit(/up\/in\/the\/air/));
    check('the area marker is flagged on its own and kept out of the worst list', /1 objects stand exactly on the 2048 m buildout-area grid/.test(all) && !/the\/area\/marker/.test(all.split('FLAG')[0]), bit(/buildout-area grid/));
    check('flat ground is flat in both frames, and says so as a mean too', /slope where things are built \(3 blocks[^)]*mean 0\.00 deg\): 0-5deg 100\.00%/.test(all) && /slope in open country[^)]*mean 0\.00 deg\): 0-5deg 100\.00%/.test(all), bit(/slope where/));
    check('a pack that names a terrain file it has not got is skipped, not thrown out of', (() => { const d3 = mkdtempSync(join(tmpdir(), 'swg-audit-')); writeFileSync(join(d3, 'layout.json'), JSON.stringify({ planet: 'gone', center: { x: 0, z: 0 }, terrain: 'nowhere.trn', objects: [] })); const out: string[] = []; auditPack(d3, { log: (l) => out.push(l) }); rmSync(d3, { recursive: true, force: true }); return out.some((l) => /SKIPPED: its layout names nowhere\.trn/.test(l)); })());
    check('and nothing is flagged as near vertical', /nothing at or past 80 degrees where anything is built/.test(all), bit(/degrees/));
    check('a pack with no terrain is passed over', (() => { const d2 = mkdtempSync(join(tmpdir(), 'swg-audit-')); writeFileSync(join(d2, 'layout.json'), JSON.stringify({ planet: 'x', center: { x: 0, z: 0 }, terrain: null, objects: [] })); const out: string[] = []; auditPack(d2, { log: (l) => out.push(l) }); rmSync(d2, { recursive: true, force: true }); return out.length === 0; })());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- the client's own baked ground heights, which are the audit's one witness that owes this
//     port nothing. A version-15 terrain file carries the ground height at every 16 m flora tile
//     as its editor wrote it, so where the generator disagrees with that map the generator is
//     wrong. Here the ground is a plane at zero and the map agrees everywhere but one tile.
{
  check('the audit plants a flora tile where the engine does', AUDIT.floraTile === CLEARANCE.collidableTile, `${AUDIT.floraTile} vs ${CLEARANCE.collidableTile}`);
  const p = floraTilePoint(0, 0, 64, 0);
  check('a tile\'s point lies inside the tile', p.x >= 0 && p.x < 16 && p.z >= 0 && p.z < 16, `${p.x}, ${p.z}`);
  const q = floraTilePoint(3, -5, 64, 0);
  check('and another tile draws its own', q.x >= 48 && q.x < 64 && q.z >= -80 && q.z < -64 && (q.x - 48 !== p.x || q.z + 80 !== p.z), `${q.x}, ${q.z}`);
  const b = floraTilePoint(0, 0, 64, 4);
  check('a border keeps the point off the tile\'s edge', b.x >= 4 && b.x <= 12 && b.z >= 4 && b.z <= 12, `${b.x}, ${b.z}`);
  const s = summariseBaked([{ err: 0.01, x: 0, z: 0 }, { err: -1.9, x: 1, z: 1 }, { err: 4, x: 2, z: 2 }, { err: -40, x: 3, z: 3 }], 2);
  check('the baked summary splits agreement, roughness and fault', s.n === 4 && s.agree === 2 && s.rough === 1 && s.bad === 1, JSON.stringify({ n: s.n, a: s.agree, r: s.rough, b: s.bad }));
  check('and names the worst first, signed', s.worst.length === 2 && s.worst[0].err === -40 && s.worst[1].err === 4, JSON.stringify(s.worst));

  const dir = mkdtempSync(join(tmpdir(), 'swg-audit-'));
  try {
    const header = new W().str('baked').f32(1024).f32(32).i32(8).i32(0).f32(0).f32(2).str('').f32(60)
      .f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(0).bytes();
    const tgen = form('TGEN', form('0000', form('SGRP', form('0006')), form('FGRP', form('0008')), form('RGRP', form('0003')), form('EGRP', form('0002')), form('MGRP', form('0000')), form('LYRS')));
    const across = 1024 / AUDIT.floraTile;
    // One bit a tile, every bit zero and the minimum 1: every tile carries flora, so every tile's
    // baked height counts. (A tile with no flora has no height baked for it.)
    const families = form('PIMP', form('0000', chunk('CNTL', new W().i32(across).i32(across).i32(1).i32(1).bytes()), chunk('DATA', new Uint8Array((across * across) / 8))));
    // A byte a tile at half a metre a step: zero everywhere but the tile at the origin, which the
    // file puts 40 m up while the generator's plane is at zero.
    const raw = new Uint8Array(across * across);
    const centre = across / 2;
    raw[centre * across + centre] = 80;
    const heights = form('PFPM', form('PIMP', form('0000', chunk('CNTL', new W().i32(across).i32(across).i32(8).i32(0).bytes()), chunk('DATA', raw))), form('0000', chunk('CNTL', new W().f32(0.5).bytes())));
    writeFileSync(join(dir, 'terrain.trn'), encode(form('PTAT', form('0015', chunk('DATA', header), tgen, families, heights, form('BAKE')))));
    writeFileSync(join(dir, 'layout.json'), JSON.stringify({ planet: 'baked', center: { x: 0, z: 0 }, terrain: 'terrain.trn', objects: [] }));
    const lines: string[] = [];
    auditPack(dir, { top: 3, wildBlocks: 16, log: (l) => lines.push(l) });
    const all = lines.join('\n');
    const bit = (re: RegExp) => (all.split('\n').find((l) => re.test(l)) ?? 'no such line').trim();
    check('the audit compares the ground with the terrain file\'s own baked heights', /the client's own baked ground heights \(4096 flora tiles\): 4095 agree within 2 m/.test(all), bit(/baked ground heights/));
    check('and flags the one tile it disagrees with, signed and placed', /FLAG the generator disagrees with the terrain file's own heights by more than 10 m at 1 of 4096 tiles/.test(all) && new RegExp(`-40\\.0 m at ${Math.round(p.x)}, ${Math.round(p.z)}`).test(all), bit(/-40\.0 m/));
    check('a world whose terrain bakes no heights says so instead of reporting nothing', (() => {
      const d2 = mkdtempSync(join(tmpdir(), 'swg-audit-'));
      writeFileSync(join(d2, 'terrain.trn'), encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE')))));
      writeFileSync(join(d2, 'layout.json'), JSON.stringify({ planet: 'nobake', center: { x: 0, z: 0 }, terrain: 'terrain.trn', objects: [] }));
      const out: string[] = [];
      auditPack(d2, { top: 2, wildBlocks: 16, log: (l) => out.push(l) });
      rmSync(d2, { recursive: true, force: true });
      return out.some((l) => /carries no baked ground heights/.test(l));
    })());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `${failures} FAILURES` : 'all passed');
process.exit(failures ? 1 : 0);
