// Putting a house on the ground: the patch it asks for, the ground test, and the spot ahead.
//
// The rules are pure, so this runs the real ones. Where the gallery pack is converted it then reads
// the real buildings' own boxes and reports what patch each asks for, which is the only way to know
// that numbers tuned on a fixture mean anything over the buildings the game really sold.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOUSE_TUNE,
  clearRadius,
  groundVerdict,
  patchOfBounds,
  patchOfFootprint,
  patchProbes,
  patchSize,
  spotAhead,
  type Patch,
} from '../../../src/world/housePlace.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const flat = (probes: readonly { x: number; z: number }[], h = 10): number[] => probes.map(() => h);

// ---------------------------------------------------------------- the patch

{
  const p = patchOfBounds({ min: [-10, -16, -6], max: [10, 8, 14] });
  ok(p.hx === 10 && p.hz === 10, 'a box twenty metres each way asks for ten metres each way');
  ok(p.cx === 0 && p.cz === 4, "the middle of a box that reaches farther one way is not the building's origin");
  const s = patchSize(p);
  ok(s.x === 20 && s.z === 20, 'the size is twice the half-extents');
}

{
  // A mesh's BOX chunk holds the larger corner first and the packs written before that was noticed
  // carry the swap, so the corners are taken componentwise and never by which one came first.
  const a = patchOfBounds({ min: [-10, 0, -6], max: [10, 8, 14] });
  const b = patchOfBounds({ min: [10, 8, 14], max: [-10, 0, -6] });
  ok(a.hx === b.hx && a.hz === b.hz && a.cx === b.cx && a.cz === b.cz, 'a swapped box gives exactly the same patch');
}

{
  // Eight cells of eight metres with the origin on cell (3, 3): 64 m square, the origin a half cell
  // off the middle each way.
  const p = patchOfFootprint({ width: 8, height: 8, pivotX: 3, pivotZ: 3, cellWidth: 8, cellHeight: 8 });
  ok(p.hx === 32 && p.hz === 32, "a footprint's half-extents are its cells times its cell size, halved");
  ok(Math.abs(p.cx - 4) < 1e-9 && Math.abs(p.cz - 4) < 1e-9, 'the origin sits on the middle of the cell the pivot names');
  const mid = patchOfFootprint({ width: 3, height: 3, pivotX: 1, pivotZ: 1, cellWidth: 4, cellHeight: 4 });
  ok(Math.abs(mid.cx) < 1e-9 && Math.abs(mid.cz) < 1e-9, 'a pivot in the middle of an odd grid leaves no offset');
}

// ---------------------------------------------------------------- the probes

{
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 0 };
  const probes = patchProbes(p, { x: 100, z: 200 }, 0, 0);
  ok(probes.length === 6, 'four corners, the middle and the doorstep');
  ok(probes[5].x === 100 && probes[5].z === 200, "the last probe is the building's own origin, which the verdict measures from");
  const xs = probes.map((q) => q.x).sort((a, b) => a - b);
  ok(xs[0] === 90 && xs[5] === 110, 'the corners reach the half-extent each way');
}

{
  // Turned a quarter turn, a patch that is long along z is long across x.
  const p: Patch = { hx: 4, hz: 20, cx: 0, cz: 0 };
  const probes = patchProbes(p, { x: 0, z: 0 }, Math.PI / 2, 0);
  const spanX = Math.max(...probes.map((q) => q.x)) - Math.min(...probes.map((q) => q.x));
  const spanZ = Math.max(...probes.map((q) => q.z)) - Math.min(...probes.map((q) => q.z));
  ok(Math.abs(spanX - 40) < 1e-6 && Math.abs(spanZ - 8) < 1e-6, 'a quarter turn swaps which way a patch is long');
}

{
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 6 };
  const probes = patchProbes(p, { x: 0, z: 0 }, 0, 0);
  ok(probes[4].z === 6, "the offset moves the ground that is tested, not just the building's picture");
  ok(probes[5].z === 0, 'and leaves the doorstep where the building was asked for');
}

{
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 0 };
  const bare = patchProbes(p, { x: 0, z: 0 }, 0, 0);
  const wide = patchProbes(p, { x: 0, z: 0 }, 0, 5);
  ok(Math.max(...wide.map((q) => q.x)) === Math.max(...bare.map((q) => q.x)) + 5, 'the margin widens the patch that is tested');
}

// ---------------------------------------------------------------- the verdict

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const v = groundVerdict(probes, flat(probes, 42));
  ok(v.ok && v.why === null, 'level ground takes a house');
  ok(v.y === 42, 'and stands it at the ground');
  ok(v.rise === 0 && v.sink === 0 && v.slope === 0, 'with nothing to report');
}

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[0] = 10 + HOUSE_TUNE.rise + 0.01;
  const v = groundVerdict(probes, h);
  ok(!v.ok && !!v.why && v.why.includes('over the doorstep'), 'ground standing over the doorstep refuses the spot, in words');
  ok(Math.abs(v.rise - (HOUSE_TUNE.rise + 0.01)) < 1e-9, 'and says by how much');
}

{
  // The rule is not symmetric, and this is the whole reason it is not one number: every one of
  // these buildings carries a foundation sixteen metres deep, so ground falling away shows nothing
  // and ground rising laps up a wall.
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const up = flat(probes, 10);
  up[0] = 10 + (HOUSE_TUNE.rise + HOUSE_TUNE.sink) / 2;
  const down = flat(probes, 10);
  down[0] = 10 - (HOUSE_TUNE.rise + HOUSE_TUNE.sink) / 2;
  ok(!groundVerdict(probes, up).ok, 'ground that rises that far is refused');
  ok(groundVerdict(probes, down).ok, 'ground that falls the same distance is taken, because the foundation is under it');
}

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[0] = 10 - HOUSE_TUNE.sink - 0.01;
  const v = groundVerdict(probes, h);
  ok(!v.ok && !!v.why && v.why.includes('falls'), 'but ground that falls away far enough is refused too, in its own words');
}

{
  // The house is stood at its own doorstep, whatever the corners are doing.
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[1] = 11;
  h[2] = 8;
  h[5] = 9.5;
  const v = groundVerdict(probes, h);
  ok(v.y === 9.5, 'the house is stood at the ground under its own origin, not at the highest or the lowest corner');
}

{
  // A long even ramp: every probe within the rise and the sink of the doorstep, and still a tilt.
  // Neither of the other two tests can see it, which is the whole reason the slope is its own.
  const probes = patchProbes({ hx: 4, hz: 4, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0, 0);
  const h = probes.map((q) => 10 + q.x * 0.3);
  const door = h[h.length - 1];
  ok(Math.max(...h) - door <= HOUSE_TUNE.rise && door - Math.min(...h) <= HOUSE_TUNE.sink, 'the ramp is within the rise and the sink');
  const v = groundVerdict(probes, h);
  ok(!v.ok && !!v.why && v.why.includes('slopes'), 'and is refused on its slope');
}

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[2] = Number.NaN;
  const v = groundVerdict(probes, h);
  ok(!v.ok && !!v.why && v.why.includes('not known'), 'ground the terrain cannot answer for is refused rather than guessed at');
}

{
  // Two probes on top of each other say nothing about slope: the run guard must skip them rather
  // than divide by nothing and call it vertical.
  const probes = [
    { x: 0, z: 0 },
    { x: 0.1, z: 0 },
    { x: 20, z: 0 },
  ];
  const v = groundVerdict(probes, [10, 11, 11]);
  ok(Number.isFinite(v.slope), 'a pair too close together is skipped rather than read as a cliff');
  ok(v.slope < 5, 'and the slope comes from the pair that is far enough apart');
}

// ---------------------------------------------------------------- the spot ahead

{
  const p: Patch = { hx: 4, hz: 4, cx: 0, cz: 0 };
  const at = spotAhead({ x: 0, z: 0 }, 0, p);
  ok(Math.abs(at.x) < 1e-9 && Math.abs(at.z + HOUSE_TUNE.ahead) < 1e-9, "facing yaw 0 puts it down the camera's own forward, which is -z");
  const right = spotAhead({ x: 0, z: 0 }, Math.PI / 2, p);
  ok(Math.abs(right.x + HOUSE_TUNE.ahead) < 1e-6 && Math.abs(right.z) < 1e-6, 'a quarter turn puts it down -x, as the camera turns');
}

{
  // A big building goes farther out than a small one, or it is built on your head.
  const small = spotAhead({ x: 0, z: 0 }, 0, { hx: 3, hz: 3, cx: 0, cz: 0 });
  const large = spotAhead({ x: 0, z: 0 }, 0, { hx: 30, hz: 30, cx: 0, cz: 0 });
  ok(Math.hypot(large.x, large.z) > Math.hypot(small.x, small.z), 'a guild hall is put down farther away than a tent');
  ok(Math.hypot(large.x, large.z) >= 30, "and at least its own half-diagonal, so its wall is not where you stand");
}

{
  // The offset is taken off, so what lands `ahead` away is the middle of the building rather than
  // whichever corner its origin happens to sit on.
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 10 };
  const at = spotAhead({ x: 0, z: 0 }, 0, p);
  const probes = patchProbes(p, at, 0, 0);
  const middle = probes[4];
  ok(Math.abs(Math.hypot(middle.x, middle.z) - Math.max(HOUSE_TUNE.ahead, Math.hypot(p.hx, p.hz) + HOUSE_TUNE.margin + 2)) < 1e-6, "the building's middle is what ends up the reach away");
}

{
  const r = clearRadius({ hx: 10, hz: 10, cx: 0, cz: 0 });
  ok(Math.abs(r - (Math.hypot(10, 10) + HOUSE_TUNE.margin)) < 1e-9, 'the flora is kept off the patch and its margin');
  ok(clearRadius({ hx: 30, hz: 30, cx: 0, cz: 0 }) > r, 'a bigger building keeps more of it off');
}

// ---------------------------------------------------------------- the real buildings

{
  const manifest = join('assets-private', 'gallery', 'manifest.json');
  if (!existsSync(manifest)) {
    note('no gallery pack here, so the real buildings are not measured (npm run swg -- gallery @SWG assets-private --retail-only)');
  } else {
    const m = JSON.parse(readFileSync(manifest, 'utf8')) as {
      categories: Record<string, { id: string; bounds?: { min: number[]; max: number[] }; cells?: unknown[] }[]>;
    };
    const all = Object.values(m.categories).flat();
    const walkIn = all.filter((d) => (d.cells?.length ?? 0) > 1 && d.bounds);
    const houses = walkIn.filter((d) => /^ply_/.test(d.id));
    ok(houses.length > 0, `${houses.length} of the ${walkIn.length} walk-in buildings in the pack are ones players bought`);
    let widest = { id: '', r: 0 };
    let offset = { id: '', d: 0 };
    for (const d of houses) {
      const p = patchOfBounds(d.bounds!);
      const r = clearRadius(p);
      if (r > widest.r) widest = { id: d.id, r };
      const off = Math.hypot(p.cx, p.cz);
      if (off > offset.d) offset = { id: d.id, d: off };
      assert.ok(p.hx > 0.5 && p.hz > 0.5, `${d.id} has a patch with a real size`);
      // The reach is taken from the middle of the patch, so the building's own far corner must be
      // clear of where the player stands however far off its origin sits.
      const at = spotAhead({ x: 0, z: 0 }, 0, p);
      const probes = patchProbes(p, at, 0, 0);
      const nearest = Math.min(...probes.map((q) => Math.hypot(q.x, q.z)));
      assert.ok(nearest > 0.5, `${d.id} is not put down on top of the player (nearest corner ${nearest.toFixed(1)} m)`);
    }
    passed++;
    console.log(`ok   every one of the ${houses.length} buildings is put down clear of the player who placed it`);
    note(`widest patch: ${widest.id} keeps the flora off ${widest.r.toFixed(1)} m`);
    note(`furthest origin from its own middle: ${offset.id}, ${offset.d.toFixed(1)} m -- which is why the patch carries an offset at all`);
    // The roughness a real world would have to be within. Reported, not asserted: what it is worth
    // is the owner's to judge by standing one on a hillside.
    note(`a spot is refused past ${HOUSE_TUNE.rise} m of ground over the doorstep, ${HOUSE_TUNE.sink} m falling away, or ${HOUSE_TUNE.slope} degrees of tilt; all three are ours`);
  }
}

// ---------------------------------------------------------------- the real ground
//
// What the thresholds are worth cannot be argued from a fixture: a house is put down on a world's
// own ground, and the question is what share of that ground will take one. So where a world is
// converted this generates its ground -- the very generator the browser runs, out of the very file
// the pack carries -- and tries a real house's patch at a lattice of spots over it. Nothing here
// reads the archives and nothing compares the ground against itself: the ground is the ground, and
// what is measured is our own two numbers against it.
{
  const { existsSync: has } = await import('node:fs');
  const worlds = ['tatooine', 'naboo', 'corellia'].filter((p) => has(join('assets-private', p, 'terrain.trn')));
  if (!worlds.length) {
    note('no converted world here, so the thresholds are not measured against real ground');
  } else {
    const { parseTerrainTemplate, TerrainSampler } = await import('../../../src/swg/terrain/trn.ts');
    // A medium house's patch, read off the pack and written out so this runs without one.
    const patch: Patch = { hx: 11.8, hz: 13.0, cx: -0.5, cz: 3.1 };
    const reach = 2000;
    const step = 137; // a prime-ish stride, so the lattice does not land on the terrain's own grid
    const allBind = { over: 0, under: 0, steep: 0 };
    for (const planet of worlds) {
      const dir = join('assets-private', planet);
      const template = parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, 'terrain.trn'))));
      const sampler = new TerrainSampler(template);
      let tried = 0;
      let took = 0;
      const by = { over: 0, under: 0, steep: 0 };
      for (let z = -reach; z <= reach; z += step) {
        for (let x = -reach; x <= reach; x += step) {
          const probes = patchProbes(patch, { x, z }, 0);
          const heights = probes.map((q) => sampler.heightAt(q.x, q.z));
          // Under the sea is not a spot at all and is no business of the ground test's.
          if (heights.some((h) => !Number.isFinite(h))) continue;
          const v = groundVerdict(probes, heights);
          tried++;
          if (v.ok) took++;
          else if (v.why!.includes('over the doorstep')) by.over++;
          else if (v.why!.includes('falls')) by.under++;
          else by.steep++;
        }
        sampler.invalidateAll();
      }
      const share = (100 * took) / Math.max(1, tried);
      assert.ok(tried > 100, `${planet}: enough spots were tried (${tried})`);
      // A threshold that takes almost nowhere is useless and one that takes everywhere is not a
      // test. Both ends are ours and both are wide, because what is wanted here is to catch a
      // number that is wrong by an order of magnitude, not to pin a tuning nobody has seen yet.
      assert.ok(share > 2, `${planet}: some of the open ground will take a house (${share.toFixed(1)}%)`);
      assert.ok(share < 99, `${planet}: the test refuses somewhere (${share.toFixed(1)}%)`);
      passed++;
      console.log(`ok   ${planet}: ${share.toFixed(1)}% of ${tried} spots across a 4 km square would take a medium house`);
      note(`     refused ${((100 * by.over) / tried).toFixed(0)}% for ground over the doorstep, ${((100 * by.under) / tried).toFixed(0)}% for ground falling away, ${((100 * by.steep) / tried).toFixed(0)}% for the slope`);
      // The one thing this really pins: all three tests must be doing work somewhere, or one of
      // them is the others in disguise, which is exactly what the first cut of this rule was.
      allBind.over += by.over;
      allBind.under += by.under;
      allBind.steep += by.steep;
    }
    ok(
      allBind.over > 0 && allBind.under > 0 && allBind.steep > 0,
      `all three tests refuse real ground somewhere (${allBind.over} over the doorstep, ${allBind.under} falling away, ${allBind.steep} too steep)`,
    );
  }
}

console.log(`\n${passed} checks passed`);
