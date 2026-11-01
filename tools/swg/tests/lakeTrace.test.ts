// A lake's outline traced at a level (Map-maker II's fifth wave, DESIGN.md §2.7, `src/editor/lakeTrace.ts`): the ground
// under the level flooded from a seed at the ground's 2 m, the shore walked and simplified. Held here: a synthetic basin
// traced at a level gives its rim within the step; simplification keeps every walked point within its tolerance and the
// outline under `mostPoints`; a level over the basin's rim spills and a seed over the level floods nothing, each said; and
// Helensar's committed raster traced at Spirit Lake's level from a seed in its largest flat region gives one outline of
// about 9.8 km² (research3's number, held within a twentieth).
//
// Run: node tools/swg/tests/lakeTrace.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { outlineArea, simplifyLoop, traceLake } from '../../../src/editor/lakeTrace.ts';
import { makeDemPatch } from '../../../src/world/demTerrain.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

/** How far a point stands off a closed outline (its nearest edge). */
function offOutline(p: readonly [number, number], loop: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[j];
    const b = loop[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1]));
  }
  return best;
}

{
  // A bowl: height r^2 / 100 about (10, -20); at level 9 its rim is the circle r = 30.
  const bowl = (x: number, z: number) => ((x - 10) ** 2 + (z + 20) ** 2) / 100;
  const r = traceLake(bowl, { x: 10, z: -20, h: 9, step: 2, reach: 200, most: 256, tolerance: 0.5 });
  ok(r.why === null && r.points.length >= 8, `a basin traced at a level gives one outline (${r.points.length} points of ${r.walked} walked)`);
  let worst = 0;
  for (const [x, z] of r.points) worst = Math.max(worst, Math.abs(Math.hypot(x - 10, z + 20) - 30));
  ok(worst <= 2, `every point of it stands on the rim within the step (worst ${worst.toFixed(3)} m)`);
  ok(Math.abs(r.area - Math.PI * 900) / (Math.PI * 900) < 0.02, `its area is the rim's (${r.area.toFixed(0)} m² against ${(Math.PI * 900).toFixed(0)})`);
  // Off-centre seed in the same basin: the same lake.
  const r2 = traceLake(bowl, { x: 25, z: -12, h: 9, step: 2, reach: 200, most: 256, tolerance: 0.5 });
  ok(r2.why === null && Math.abs(r2.area - r.area) / r.area < 0.02, 'a seed anywhere in the basin floods the same lake');
  // Over the rim: a basin whose rim stands at 4 m (a bowl clipped flat past r = 20), traced at 5: the flood spills.
  const clipped = (x: number, z: number) => Math.min(4, bowl(x, z));
  const spill = traceLake(clipped, { x: 10, z: -20, h: 5, step: 2, reach: 120, most: 256, tolerance: 0.5 });
  ok(spill.points.length === 0 && /spills/.test(spill.why ?? ''), `a level over the basin's rim spills, and says so (${spill.why})`);
  const dry = traceLake(bowl, { x: 60, z: -20, h: 9, step: 2, reach: 120, most: 256, tolerance: 0.5 });
  ok(dry.points.length === 0 && /seed/.test(dry.why ?? ''), 'a seed standing over the level floods nothing, and says so');
  // Two basins side by side under the level: only the seed's own is traced.
  const two = (x: number, z: number) => Math.min(((x + 40) ** 2 + z * z) / 100, ((x - 40) ** 2 + z * z) / 100, 20);
  const left = traceLake(two, { x: -40, z: 0, h: 9, step: 2, reach: 200, most: 256, tolerance: 0.5 });
  ok(left.why === null && left.points.every(([x]) => x < 0), "of two basins under the level only the seed's own is the lake");
}

{
  // Simplification: a jagged ring of 2,000 points.
  const ring: [number, number][] = [];
  for (let i = 0; i < 2000; i++) {
    const a = (i / 2000) * Math.PI * 2;
    const rad = 500 + 40 * Math.sin(a * 7) + 3 * Math.sin(a * 211);
    ring.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  for (const tol of [0.5, 2, 8]) {
    const s = simplifyLoop(ring, tol);
    let worst = 0;
    for (const p of ring) worst = Math.max(worst, offOutline(p, s));
    ok(s.length < ring.length && worst <= tol + 1e-9, `simplified within ${tol} m: ${s.length} points, every walked point within ${worst.toFixed(3)} m`);
  }
  ok(simplifyLoop([[0, 0], [1, 0], [0, 1]], 5).length === 3, 'never under three points');
  // Traced with a ceiling on its points, the tolerance doubled until it fits.
  const wobble = (x: number, z: number) => {
    const a = Math.atan2(z, x);
    const rad = 300 + 30 * Math.sin(a * 9) + 6 * Math.sin(a * 77);
    return Math.hypot(x, z) < rad ? 0 : 10;
  };
  const t = traceLake(wobble, { x: 0, z: 0, h: 5, step: 2, reach: 400, most: 40, tolerance: 0.5 });
  ok(t.why === null && t.points.length <= 40 && t.tolerance > 0.5, `a ceiling of 40 points is kept (${t.points.length} points at ${t.tolerance} m)`);
  ok(Math.abs(outlineArea([[0, 0], [10, 0], [10, 10], [0, 10]]) - 100) < 1e-9 && outlineArea([[0, 0], [0, 10], [10, 10], [10, 0]]) === 100, 'the area of an outline either way round');
}

{
  // Helensar's Spirit Lake: the committed raster, the largest exactly flat region's first sample as the seed.
  const root = join(REPO, 'public/dem/helens');
  if (!existsSync(join(root, 'base16.raw')) || !existsSync(join(root, 'base.json'))) note('Helensar\'s raster is not here: Spirit Lake is not traced');
  else {
    const meta = JSON.parse(readFileSync(join(root, 'base.json'), 'utf8')) as { base: { samples: number; metresPerSample: number } };
    const buf = readFileSync(join(root, 'base16.raw'));
    const size = 24576;
    const patch = makeDemPatch(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, meta as never, { size, feather: 0, lift: -299.8861083984375 } as never);
    const n = meta.base.samples;
    const v = new Uint16Array(buf.buffer, buf.byteOffset, n * n);
    const flat = new Uint8Array(n * n);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      const x = v[k];
      if (v[k - 1] === x && v[k + 1] === x && v[k - n] === x && v[k + n] === x) flat[k] = 1;
    }
    const seen = new Uint8Array(n * n);
    let best = 0;
    let bestK = -1;
    const stack: number[] = [];
    for (let k = 0; k < n * n; k++) {
      if (!flat[k] || seen[k]) continue;
      let c = 0;
      stack.push(k);
      seen[k] = 1;
      while (stack.length) {
        const q = stack.pop()!;
        c++;
        for (const d of [q - 1, q + 1, q - n, q + n]) if (d >= 0 && d < n * n && flat[d] && !seen[d] && v[d] === v[k]) {
          seen[d] = 1;
          stack.push(d);
        }
      }
      if (c > best) {
        best = c;
        bestK = k;
      }
    }
    const flatKm2 = (best * meta.base.metresPerSample ** 2) / 1e6;
    const i = bestK % n;
    const j = Math.floor(bestK / n);
    const gx = -size / 2 + i * (size / (n - 1));
    const gz = -size / 2 + j * (size / (n - 1));
    const height = (x: number, z: number) => patch.heightAt(x, z, () => Number.NaN) ?? Number.NaN;
    const h0 = height(gx, gz);
    const t0 = Date.now();
    const r = traceLake(height, { x: gx, z: gz, h: h0 + 0.05, step: 2, reach: 6000, most: 256, tolerance: 0.5 });
    const km2 = r.area / 1e6;
    ok(r.why === null && r.points.length <= 256, `Spirit Lake traced at ${(h0 + 0.05).toFixed(2)} m from a seed in its largest flat region: one outline of ${r.points.length} points (${Date.now() - t0} ms)`);
    ok(Math.abs(km2 - 9.8) / 9.8 <= 1 / 20, `about 9.8 km², research3's own number within a twentieth (${km2.toFixed(3)} km²; the raster's flat region ${flatKm2.toFixed(2)} km²)`);
  }
}

console.log(`lakeTrace: ${checks} checks passed`);
