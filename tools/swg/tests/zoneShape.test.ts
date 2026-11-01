// The zones' one shape test (Map-maker II's eighth wave, `src/world/zoneShape.ts`): a point and a circle round it against a
// circle, a rectangle, an outline and a ring, each held to a plain reference worked out here a different way (the circle's
// distance to a shape's nearest point, by sampling its edges finely), over thousands of points and radii; the box pre-test
// never refusing what the shape would take; the smallest zone holding a point; and the asks allocation-free, measured in a
// dozen processes of their own (`zoneAlloc.ts`).
//
// Run: node tools/swg/tests/zoneShape.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ZONE_CIRCLE, ZONE_POLY, ZONE_RECT, ZONE_RING, ZoneList, smallestAt, zoneAt, zoneTouches } from '../../../src/world/zoneShape.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The reference: whether a point is inside an outline (crossings, written again), and its distance to the outline's edges. */
function insideRef(pts: [number, number][], x: number, z: number): boolean {
  let c = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    if ((az <= z && bz > z) || (bz <= z && az > z)) {
      const t = (z - az) / (bz - az);
      if (ax + t * (bx - ax) > x) c++;
    }
  }
  return c % 2 === 1;
}
/** The distance from a point to a closed outline's edges, by sampling each edge every centimetre (a slow way on purpose). */
function edgeDistRef(pts: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.01));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z));
    }
  }
  return best;
}

let s = 9;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);

{
  const L = new ZoneList();
  const circle = L.addCircle(10, -5, 20, 0);
  const rect = L.addRect(60, 40, 20, 10, 1);
  const ring = L.addRing(-50, 50, 10, 25, 2);
  const ell: [number, number][] = [[-60, -60], [-20, -60], [-20, -50], [-50, -50], [-50, -20], [-60, -20]];
  const poly = L.addPoly(ell.flat(), 3);
  ok(L.count === 4 && L.kinds[circle] === ZONE_CIRCLE && L.kinds[rect] === ZONE_RECT && L.kinds[ring] === ZONE_RING && L.kinds[poly] === ZONE_POLY, 'a list of each kind of zone');
  ok(L.p[rect * 4] === 20 && L.p[rect * 4 + 3] === 40, "a rectangle's corners put in order whichever comes first");
  ok(Math.abs(L.area[poly] - (40 * 10 + 10 * 30)) < 1e-9 && Math.abs(L.area[ring] - Math.PI * (625 - 100)) < 1e-9, "an outline's and a ring's areas");
  let bad = 0;
  let tried = 0;
  for (let k = 0; k < 4000; k++) {
    const x = rnd() * 160 - 80;
    const z = rnd() * 160 - 80;
    const r = k % 3 === 0 ? 0 : rnd() * 12;
    // Circle: within its radius and r of its middle.
    const dc = Math.hypot(x - 10, z + 5);
    const wantC = dc <= 20 + r;
    // Rectangle: the distance to its nearest point.
    const qx = Math.max(20, Math.min(60, x));
    const qz = Math.max(10, Math.min(40, z));
    const wantR = Math.hypot(x - qx, z - qz) <= r;
    // Ring: the circle reaches between its two radii.
    const dr = Math.hypot(x + 50, z - 50);
    const wantG = Math.max(0, dr - r) <= 25 && dr + r >= 10;
    // Outline: inside, or an edge within r.
    const wantP = insideRef(ell, x, z) || (r > 0 && edgeDistRef(ell, x, z) <= r + 0.005);
    const got = [zoneTouches(L, circle, x, z, r), zoneTouches(L, rect, x, z, r), zoneTouches(L, ring, x, z, r), zoneTouches(L, poly, x, z, r)];
    // An edge within the reference's centimetre of the radius is a tie the two ways may break apart.
    const nearTie = r > 0 && Math.abs(edgeDistRef(ell, x, z) - r) < 0.01;
    if (got[0] !== wantC || got[1] !== wantR || got[2] !== wantG || (!nearTie && got[3] !== wantP)) bad++;
    tried++;
    // The box's pre-test never refuses what the shape takes.
    const first = zoneAt(L, x, z, r);
    const any = got.some(Boolean);
    if ((first >= 0) !== any || (first >= 0 && !got[first])) bad++;
  }
  ok(bad === 0, `a point and a circle (radius 0 to 12 m) against each kind, held to the reference over ${tried} points (${bad} apart)`);
  ok(zoneTouches(L, ring, -50, 50, 0) === false && zoneTouches(L, ring, -50, 50, 10.5) === true, "a ring's hole holds nothing, and a circle reaching its inner edge from the hole touches it");
}

{
  // The smallest holding a point: a town inside a region inside a wide area.
  const L = new ZoneList();
  L.addRect(-1000, -1000, 1000, 1000, 0);
  L.addCircle(0, 0, 300, 1);
  L.addPoly([-40, -40, 40, -40, 40, 40, -40, 40], 2);
  ok(L.tag[smallestAt(L, 0, 0)] === 2 && L.tag[smallestAt(L, 100, 0)] === 1 && L.tag[smallestAt(L, 900, 900)] === 0 && smallestAt(L, 2000, 0) === -1, 'the smallest zone holding a point wins, and outside every zone none does');
  const R = new ZoneList();
  R.addPoly([-40, -40, 40, -40, 40, 40, -40, 40], 2);
  R.addRect(-1000, -1000, 1000, 1000, 0);
  ok(R.tag[smallestAt(R, 0, 0)] === 2, 'whichever order they were added in');
  L.clear();
  ok(L.count === 0 && zoneAt(L, 0, 0, 5) === -1 && L.addCircle(0, 0, 1, 7) === 0, 'a list cleared holds nothing and is filled again from its start');
}

{
  // A list grows past its first arrays and keeps every zone.
  const L = new ZoneList();
  for (let i = 0; i < 200; i++) L.addPoly([i * 10, 0, i * 10 + 5, 0, i * 10 + 5, 5], i);
  let held = 0;
  for (let i = 0; i < 200; i++) if (L.tag[smallestAt(L, i * 10 + 4, 1)] === i) held++;
  ok(held === 200, `two hundred outlines added past the first arrays, each found again (${held})`);
}

// The asks make nothing, in a dozen processes at once (a measure run alone can pass on the compiler's luck).
const file = fileURLToPath(new URL('./zoneAlloc.ts', import.meta.url));
const run = () =>
  new Promise<{ asks: number; made: number; scavenges: number; touched: number; held: number; zones: number }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const line = out.trim().split('\n').pop() ?? '';
      if (code !== 0) return reject(new Error(`the allocation child exited ${code}: ${err.trim().split('\n').pop() ?? line}`));
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
      }
    });
  });
const all = await Promise.all(Array.from({ length: 12 }, () => run()));
for (let i = 0; i < all.length; i++) {
  const a = all[i];
  ok(a.zones === 120 && a.touched > 0 && a.held > 0 && a.scavenges === 0 && a.made < 0.02 * a.asks, `process ${i + 1} of 12: ${a.asks} asks of ${a.zones} zones make ${Math.max(0, a.made)} bytes (${(Math.max(0, a.made) / a.asks).toFixed(4)} an ask, ${a.scavenges} collections)`);
}

console.log(`zoneShape: ${checks} checks passed`);
