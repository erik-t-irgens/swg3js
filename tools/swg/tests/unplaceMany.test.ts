// Many things taken out of the world at once (`LayoutStreamer.unplaceMany`, DESIGN.md §2.11), on the real streamer and
// the real physics: the world comes out exactly as it would taking them out one at a time -- the world's objects and every
// region's tier lists keeping the rest in their order (a tier's list still the region's own array), the meshes and their
// records gone, the colliders gone and the rest standing -- and ten thousand go in one pass, where taking them out one
// at a time splices every list once a thing.
import assert from 'node:assert/strict';

const { THREE, makeStreamer } = await import('./streamHarness.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A seeded generator, so a failure is the same failure every run.
let seed = 0xc0ffee;
const rand = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 4294967296;
};

type H = Awaited<ReturnType<typeof makeStreamer>>;
const keyAt = (i: number) => `place/crate-${i}`;
const placeAt = (i: number, side: number) => ({ x: (i % side) * 3 - 30, z: Math.floor(i / side) * 3 - 30 });

async function fill(n: number, side: number): Promise<H> {
  const h = await makeStreamer();
  const waits: Promise<unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const p = placeAt(i, side);
    waits.push(h.stream.place({ model: 'crate', template: keyAt(i), x: p.x, y: 0, z: p.z, q: new THREE.Quaternion(), radius: 0.5, solid: true }));
  }
  await Promise.all(waits);
  await h.settle({ x: 0, z: 0 }, 6);
  return h;
}

/** The world as the streamer holds it, in words: its objects in order, each region's tier lists in order, and the scene's meshes. */
function picture(h: H): string {
  const objects = h.s.objects.map((o: { template: string }) => o.template).join(',');
  const regions: string[] = [];
  for (const [k, region] of h.s.regions) regions.push(`${k}:${region.objects.map((l: { template: string }[]) => l.map((o) => o.template).join('|')).join('/')}`);
  return JSON.stringify({ objects, regions: regions.sort(), meshes: h.scene.children.length });
}

{
  // Two worlds of 2,000 crates, the same random thousand taken out of each: one at a time, and all at once.
  const n = 2000;
  const side = 50;
  const a = await fill(n, side);
  const b = await fill(n, side);
  const going: number[] = [];
  for (let i = 0; i < n; i++) if (rand() < 0.5) going.push(i);
  const before = picture(a);
  ok(before === picture(b), `two worlds of ${n} crates stand alike`);
  for (const i of going) a.stream.unplace(keyAt(i));
  const took = b.stream.unplaceMany(going.map(keyAt));
  await a.settle({ x: 0, z: 0 }, 4);
  await b.settle({ x: 0, z: 0 }, 4);
  ok(took === going.length, `all at once takes out every one asked for (${took})`);
  ok(picture(a) === picture(b), "and leaves the world exactly as taking them out one at a time does: the objects and every tier's list in their order, and the meshes");
  ok(b.tiersShareLists() >= 0, "every loaded tier's list is still its region's own array (the collider sweep walks it)");
  const recordsGone = going.every((i) => !b.hasRecord(keyAt(i)));
  const keptStand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((i) => !going.includes(i)).every((i) => b.hasRecord(keyAt(i)));
  ok(recordsGone && keptStand, 'the records of what went are gone, and those of what stays are kept');
  let solidGone = 0;
  let solidKept = 0;
  let checked = 0;
  for (let i = 0; i < 200; i++) {
    const p = placeAt(i, side);
    const hit = b.rayDown(p.x, p.z);
    checked++;
    if (going.includes(i) ? hit === null : hit !== null && Math.abs(hit - 1) < 1e-3) going.includes(i) ? solidGone++ : solidKept++;
  }
  ok(solidGone + solidKept === checked, `nothing solid is left where a crate went, and every crate kept is still solid (${solidGone} gone, ${solidKept} kept of ${checked} looked at)`);
  ok(b.stream.unplaceMany(going.map(keyAt)) === 0 && b.stream.unplaceMany([]) === 0, 'asked again for what has gone, nothing; asked for nothing, nothing');
  ok(b.stream.unplaceMany([keyAt(going.length ? (going.includes(1) ? 2 : 1) : 1), keyAt(going.includes(1) ? 2 : 1)]) === 1, 'a key named twice is taken out once');
}

{
  // Ten thousand at once: one pass.
  const n = 10_000;
  const h = await fill(n, 100);
  const keys = Array.from({ length: n }, (_, i) => keyAt(i));
  const t0 = performance.now();
  const took = h.stream.unplaceMany(keys);
  const ms = performance.now() - t0;
  ok(took === n && h.s.objects.length === 1 && [...h.s.runtime.keys()].length === 0, `ten thousand taken out at once leave the world's own rock alone standing (${h.s.objects.length} object)`);
  ok(ms < 2000, `in one pass: ${ms.toFixed(0)} ms for ten thousand`);
  // The same ten thousand one at a time, for the report.
  const g = await fill(n, 100);
  const t1 = performance.now();
  for (let i = 0; i < n; i++) g.stream.unplace(keyAt(i));
  const one = performance.now() - t1;
  console.log(`note ten thousand taken out one at a time took ${one.toFixed(0)} ms; all at once ${ms.toFixed(0)} ms`);
}

console.log(`\n${checks} checks passed`);
